import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import {
  BOARDS,
  deckProblems,
  deckStats,
  deckText,
  deckView,
  DeckId,
  decksFor,
  findCard,
  fingerprint,
  FORMATS,
  MAX_QUANTITY,
  roleTargets,
  shortList,
  type DeckProblem,
  type DeckView,
} from "@/modules/decks";
import { problemText } from "@/app/decks/labels";
import {
  cardNotFound,
  deckNotFound,
  defineTool,
  done,
  failed,
  money,
  moneyOrNull,
  type ToolContext,
} from "../tool";

// Reading and editing decks (design doc 28, section 5.2). Edits go through the decks module's
// use cases with the token's Actor, so they follow the same rules as the deck builder.

const deckId = z.number().int().positive().describe("The deck's id, from list_decks.");
const board = z
  .enum(BOARDS)
  .default("main")
  .describe('Which part of the deck: "main", "side" (sideboard) or "commander".');
const card = z
  .string()
  .min(1)
  .describe("The card's exact English name (a double-faced card's front name works), or its id.");

/** The deck as the edit tools need it: its list text and the fingerprint of what's stored. */
function listAndFingerprint(view: DeckView): { list: string; fingerprint: string } {
  const list = deckText(
    view.lines.map((line) => ({
      quantity: line.quantity,
      name: line.name,
      board: line.board,
      setCode: line.pinnedPrintingId === null ? null : line.setCode,
      collectorNumber: line.pinnedPrintingId === null ? null : line.collectorNumber,
      finish: line.pinnedFinish,
    })),
  );
  const print = fingerprint(
    view.lines.map((line) => ({
      ...line,
      printingId: line.pinnedPrintingId,
      finish: line.pinnedFinish,
    })),
  );
  return { list, fingerprint: print };
}

function problemsOf(view: DeckView): DeckProblem[] {
  const owned = new Map(view.lines.map((line) => [line.oracleId, line.owned]));
  return deckProblems(
    view.deck,
    (oracleId) => view.rules[oracleId],
    (oracleId) => owned.get(oracleId) ?? 0,
  );
}

async function viewFor(context: ToolContext, id: number) {
  return deckView(context.container.db, context.actor.userId, id);
}

export const listDecks = defineTool({
  name: "list_decks",
  title: "List my decks",
  description: [
    "Lists your decks, most recently changed first: id, name, format, card count, and how many cards each is short (copies the deck uses that you don't own).",
    "Use it when: you need a deck's id, or an overview of the decks. Then call get_deck for one deck.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const decks = await decksFor(context.container.db, context.actor.userId);
    return done({
      decks: decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
        format: deck.format,
        cards: deck.cards,
        short: deck.short,
        usesRealCards: deck.usesRealCards,
        visibility: deck.visibility,
        updatedAt: deck.updatedAt,
      })),
    });
  },
});

export const getDeck = defineTool({
  name: "get_deck",
  title: "Get a deck",
  description: [
    "One deck in full: every card with how many you own, the deck's statistics (mana curve, colors, types, role counts against the format's targets), what's wrong with it (short cards, size, legality, color identity), its list as text, and its fingerprint.",
    "Use it when: starting work on a deck (read the commander's text first), before replace_deck_list (pass its fingerprint), and to check your changes.",
    'Returns: lines (board, quantity, owned; "owned < quantity" means short), stats, roleTargets (commander decks: ramp, draw, removal, wipe), problems in words, list (the text replace_deck_list takes), shortList (the missing cards as a list).',
    "Rules: decks may hold cards you don't own; they show as short. Basic lands are never short.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includeText: z
      .boolean()
      .default(true)
      .describe("Include each card's rules text. Set false to save space on big decks."),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const problems = problemsOf(view);
    const stats = deckStats(view.lines);
    const { list, fingerprint: print } = listAndFingerprint(view);
    return done({
      deck: {
        id: view.deck.id,
        name: view.deck.name,
        format: view.deck.format,
        usesRealCards: view.deck.usesRealCards,
      },
      fingerprint: print,
      lines: view.lines.map((line) => ({
        name: line.name,
        oracleId: line.oracleId,
        printingId: line.printingId,
        board: line.board,
        quantity: line.quantity,
        owned: line.owned,
        manaCost: line.manaCost,
        manaValue: line.manaValue,
        typeLine: line.typeLine,
        ...(input.includeText ? { text: line.text } : {}),
        price: moneyOrNull(line.priceCents),
      })),
      stats: {
        cardCount: stats.cardCount,
        lands: stats.lands,
        otherManaSources: stats.otherManaSources,
        averageManaValue: Math.round(stats.averageManaValue * 100) / 100,
        curve: stats.curve,
        types: stats.types,
        pips: stats.pips,
        sources: stats.sources,
        roles: stats.tags,
        value: money(stats.priceCents),
      },
      roleTargets: roleTargets(view.deck.format),
      problems: problems.map(problemText),
      list,
      shortList: shortList(problems, view.lines),
    });
  },
});

export const createDeck = defineTool({
  name: "create_deck",
  title: "Create a deck",
  description: [
    "Makes a new, empty deck and returns its id. Optionally fills it from a list in the usual text format.",
    'Use it when: the player wants a new deck. Then add cards with set_deck_entry, or pass a whole list here ("Commander" / "Deck" / "Sideboard" headings, then lines like "1 Sol Ring").',
    "Rules: cards you don't own may be added; they show as short.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    name: z.string().min(1).max(60).describe("The deck's name, up to 60 characters."),
    format: z.enum(FORMATS).default("commander").describe("The deck's format."),
    list: z
      .string()
      .default("")
      .describe(
        'Optional cards to start with, one per line: "1 Sol Ring". Headings: Commander, Deck, Sideboard.',
      ),
  }),
  async run(context, input) {
    const { decks } = context.container;
    const created = await decks.createDeck(context.actor, {
      name: input.name,
      format: input.format,
    });
    if (!created.ok) {
      return created.error.kind === "NameInvalid"
        ? failed(
            "NameInvalid",
            `Give the deck a name of up to ${created.error.maximum} characters.`,
          )
        : failed(
            "TooManyDecks",
            `You already have ${created.error.maximum} decks; that's the most.`,
          );
    }
    if (input.list.trim() === "") return done({ deckId: created.value, added: 0 });
    const imported = await decks.importList(context.actor, {
      deckId: created.value,
      text: input.list,
    });
    if (!imported.ok)
      return done({ deckId: created.value, added: 0, listError: imported.error.kind });
    return done({
      deckId: created.value,
      added: imported.value.added,
      unreadable: imported.value.unreadable,
      notFound: imported.value.notFound,
    });
  },
});

export const updateDeck = defineTool({
  name: "update_deck",
  title: "Rename a deck or change its format",
  description: [
    "Changes a deck's name, format, or whether your real cards count as owned in it. Leave out what stays the same.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    name: z.string().min(1).max(60).optional().describe("A new name, up to 60 characters."),
    format: z.enum(FORMATS).optional().describe("A new format."),
    usesRealCards: z
      .boolean()
      .optional()
      .describe("Whether your real (paper) cards count as owned in this deck."),
  }),
  async run(context, input) {
    const result = await context.container.decks.updateDeck(context.actor, {
      deckId: DeckId.of(input.deckId),
      name: input.name,
      format: input.format,
      usesRealCards: input.usesRealCards,
    });
    if (!result.ok) {
      return result.error.kind === "DeckNotFound"
        ? deckNotFound(input.deckId)
        : failed(
            "NameInvalid",
            `Give the deck a name of up to ${result.error.maximum} characters.`,
          );
    }
    return done({ deckId: input.deckId, updated: true });
  },
});

export const setDeckEntry = defineTool({
  name: "set_deck_entry",
  title: "Set how many of a card a deck has",
  description: [
    "Sets how many copies of one card a deck has on one board: 0 removes it. It sets the count, it doesn't add to it.",
    "Use it when: adding, removing or changing a few cards. For many changes at once, use replace_deck_list.",
    "Rules: cards you don't own may be added (they show as short); prefer owned cards. Check the result with get_deck.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    card,
    quantity: z
      .number()
      .int()
      .min(0)
      .max(MAX_QUANTITY)
      .describe("How many copies the deck should have; 0 removes the card."),
    board,
  }),
  async run(context, input) {
    const found = await findCard(context.container.db, input.card);
    if (found === null) return cardNotFound(input.card);
    const result = await context.container.decks.setEntry(context.actor, {
      deckId: DeckId.of(input.deckId),
      oracleId: found.oracleId,
      board: input.board,
      quantity: input.quantity,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "CardNotFound":
          return cardNotFound(input.card);
        case "QuantityInvalid":
          return failed("QuantityInvalid", `Use 0 to ${result.error.maximum} copies.`);
      }
    }
    return done({
      deckId: input.deckId,
      card: found.name,
      board: input.board,
      quantity: input.quantity,
    });
  },
});

export const replaceDeckList = defineTool({
  name: "replace_deck_list",
  title: "Replace a deck's whole list",
  description: [
    "Replaces the deck's cards with a list in the usual text format, all or nothing.",
    "Use it when: making many changes at once. First call get_deck, edit its `list`, and send it back with the `fingerprint` get_deck gave.",
    'Inputs: list, with headings "Commander", "Deck", "Sideboard" and lines like "1 Sol Ring" or "1 Sol Ring (C21) 263" for a printing.',
    "Returns: the new card count. If the deck changed since your get_deck (DeckChanged), call get_deck again and redo your edit. If some lines couldn't be used (ListProblems), nothing was saved: fix those lines.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    list: z.string().min(1).describe("The deck's complete new list."),
    fingerprint: z.string().min(1).describe("The fingerprint from your latest get_deck."),
  }),
  async run(context, input) {
    const result = await context.container.decks.replaceList(context.actor, {
      deckId: DeckId.of(input.deckId),
      text: input.list,
      fingerprint: input.fingerprint,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "DeckChanged":
          return failed(
            "DeckChanged",
            "The deck changed since your get_deck. Call get_deck again, redo the edit on its new list, and send its new fingerprint.",
          );
        case "ListTooLong":
          return failed("ListTooLong", `A list may have up to ${result.error.maximumLines} lines.`);
        case "ListProblems":
          return failed(
            "ListProblems",
            `Nothing was saved. Unreadable lines: ${JSON.stringify(result.error.unreadable)}. Cards not found: ${JSON.stringify(result.error.notFound)}.`,
          );
      }
    }
    return done({ deckId: input.deckId, cards: result.value.cards });
  },
});

export const choosePrinting = defineTool({
  name: "choose_printing",
  title: "Choose which printing a deck shows",
  description: [
    "Pins the printing and finish a deck line shows and exports, or clears the pin so it follows your copies again.",
    "Use it when: the player asks for a particular art or set. Get printing ids from get_card.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    card,
    board,
    printingId: z
      .string()
      .default("")
      .describe("The printing to pin (from get_card), or empty to clear the pin."),
    finish: z.enum(["nonfoil", "foil", "etched"]).default("nonfoil").describe("The finish to pin."),
  }),
  async run(context, input) {
    const found = await findCard(context.container.db, input.card);
    if (found === null) return cardNotFound(input.card);
    const result = await context.container.decks.choosePrinting(context.actor, {
      deckId: DeckId.of(input.deckId),
      oracleId: found.oracleId,
      board: input.board,
      pinned:
        input.printingId === ""
          ? null
          : { printingId: PrintingId.of(input.printingId), finish: input.finish },
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "EntryNotFound":
          return failed(
            "EntryNotFound",
            `The deck has no ${found.name} on the ${input.board} board.`,
          );
        case "PrintingNotOfCard":
          return failed("PrintingNotOfCard", `That printing isn't a printing of ${found.name}.`);
        case "FinishNotAvailable":
          return failed("FinishNotAvailable", `That printing doesn't come in ${input.finish}.`);
      }
    }
    return done({ deckId: input.deckId, card: found.name, pinned: input.printingId !== "" });
  },
});
