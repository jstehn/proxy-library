import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import {
  BOARDS,
  bracketLine,
  bracketWarning,
  deckProblems,
  deckStats,
  deckText,
  deckView,
  DeckId,
  estimateBracket,
  decksFor,
  findCard,
  fingerprint,
  FORMATS,
  GROUPINGS,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  MAX_QUANTITY,
  rankCuts,
  roleTargets,
  shortList,
  type DeckProblem,
  type DeckView,
} from "@/modules/decks";
import {
  bracketWarningText,
  cutReasonText,
  estimateLabel,
  findingWithCards,
  problemText,
  UNCHECKED_TEXT,
} from "@/app/decks/labels";
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
import { assertNever } from "@/shared/kernel";

// Reading and editing decks (design doc 28, section 5.2). Edits go through the decks module's
// use cases with the token's Actor, so they follow the same rules as the deck builder.

const deckId = z.number().int().positive().describe("The deck's id, from list_decks.");
const board = z
  .enum(BOARDS)
  .default("main")
  .describe(
    'Which part of the deck: "main", "side" (sideboard), "commander", or "maybe" (the maybeboard: cards being considered, counted nowhere).',
  );
/** What a heading refusal says (design doc 34), shared by set_deck_entry and arrange_headings. */
const HEADING_RULE = `A heading starts with a letter, has at most ${MAX_HEADING_LENGTH} characters, and isn't a board or card type name ("Sideboard", "Creatures"). A deck has at most ${MAX_HEADINGS}.`;

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
      heading: line.heading,
    })),
    // Grouped by its own headings, the list shows them as "Ramp (9)" blocks (design doc 34).
    view.deck.grouping === "custom" ? view.deck.headings : null,
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

/** The bracket estimate and target, as get_deck reports them (design doc 31). Null outside Commander. */
function bracketOf(view: DeckView) {
  const estimate = estimateBracket(view.deck.format, view.lines.map(bracketLine));
  if (estimate === null) return null;
  const warning = bracketWarning(estimate, view.deck.targetBracket);
  return {
    target: view.deck.targetBracket,
    floor: estimate.floor,
    range: estimate.range,
    summary: `${estimateLabel(estimate)} (at least, from the cards)`,
    gameChangers: estimate.gameChangers,
    findings: estimate.findings.map((finding) => ({
      rule: finding.rule,
      count: finding.count,
      forces: finding.forces,
      cards: finding.cards,
      text: findingWithCards(finding),
    })),
    overTarget: warning === null ? null : bracketWarningText(warning),
    unchecked: UNCHECKED_TEXT,
  };
}

async function viewFor(context: ToolContext, id: number) {
  return deckView(context.container.db, context.actor.userId, id);
}

/** The most cut candidates rank_cuts returns at once. */
const MAX_CUTS = 30;

export const rankCutsTool = defineTool({
  name: "rank_cuts",
  title: "Possible cuts for a deck",
  description: [
    "Ideas for what a deck could cut: the main-deck cards that score lowest on a few simple checks, lowest first, each with a rough keep score and the reasons in words (matches none of the themes the app found, a role the deck has more of than its target, expensive in a high curve, over the target bracket, not owned; reasons a card scored higher are listed too). Lands and commanders aren't ranked.",
    "Use it when: the deck is over its size, or the player asks what to cut. It's a starting point, not a verdict: the checks read rules text with fixed patterns, so they miss combos, synergies they have no rule for, and the player's plan. Judge each card by its text (get_deck with includeText) and present cuts as options with your reasons.",
    'Rules: suggest cuts, don\'t make them unasked; the player decides. To set a card aside, move it to the maybeboard with set_deck_entry (0 on "main", then the same count on "maybe").',
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    count: z
      .number()
      .int()
      .min(1)
      .max(MAX_CUTS)
      .default(10)
      .describe(`How many cards to return, lowest score first (1 to ${MAX_CUTS}).`),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const cuts = rankCuts(view.lines, {
      format: view.deck.format,
      targetBracket: view.deck.targetBracket,
    });
    return done({
      deck: { id: view.deck.id, name: view.deck.name, format: view.deck.format },
      cuts: cuts.slice(0, input.count).map((cut) => ({
        name: cut.name,
        keepScore: Math.round(cut.keepScore * 10) / 10,
        why: cut.reasons.map(cutReasonText),
      })),
      candidates: cuts.length,
    });
  },
});

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
    "One deck in full: every card with how many you own, the deck's statistics (mana curve, colors, types, role counts against the format's targets), what's wrong with it (short cards, size, legality, color identity), its Commander bracket, its list as text, and its fingerprint.",
    "Use it when: starting work on a deck (read the commander's text first), before replace_deck_list (pass its fingerprint), and to check your changes.",
    'Returns: lines (board, quantity, owned, isGameChanger; "owned < quantity" means short; free and otherDecks when another of your decks also uses the card), stats, roleTargets (commander decks: ramp, draw, removal, wipe), problems in words, bracket (commander decks: the target the player chose, the lowest bracket the cards allow and why, and overTarget when the cards go over the target), list (the text replace_deck_list takes), shortList (the missing cards as a list).',
    'Rules: decks may hold cards you don\'t own; they show as short. Basic lands are never short. Your decks share the copies you own: free is how many no other deck uses, and otherDecks lists the decks holding the rest (deckId, name, quantity). Lines on the "maybe" board (the maybeboard) are cards being considered: they count in nothing (size, stats, problems, bracket, short).',
    'Headings: the player may group the main deck under headings of their own ("Ramp", "Win conditions"): a line\'s heading, the deck\'s headings in order, and grouping ("custom" when the deck is shown by them, "type" when by card type). Change them with set_deck_entry\'s heading and arrange_headings.',
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
        grouping: view.deck.grouping,
        headings: view.deck.headings,
      },
      fingerprint: print,
      lines: view.lines.map((line) => ({
        name: line.name,
        oracleId: line.oracleId,
        printingId: line.printingId,
        board: line.board,
        quantity: line.quantity,
        ...(line.heading !== null ? { heading: line.heading } : {}),
        owned: line.owned,
        ...(line.otherDecks.length > 0
          ? {
              free: line.free,
              otherDecks: line.otherDecks.map((use) => ({
                deckId: use.deckId,
                name: use.name,
                quantity: use.quantity,
              })),
            }
          : {}),
        manaCost: line.manaCost,
        manaValue: line.manaValue,
        typeLine: line.typeLine,
        ...(line.isGameChanger ? { isGameChanger: true } : {}),
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
      bracket: bracketOf(view),
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
    'Use it when: the player wants a new deck. Then add cards with set_deck_entry, or pass a whole list here ("Commander" / "Deck" / "Sideboard" / "Maybeboard" headings, or headings of the player\'s own such as "Ramp (2)", then lines like "1 Sol Ring").',
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
        'Optional cards to start with, one per line: "1 Sol Ring". Headings: Commander, Deck, Sideboard, Maybeboard.',
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
  title: "Rename a deck, change its format or target bracket",
  description: [
    "Changes a deck's name, format, target bracket, grouping, or whether your real cards count as owned in it. Leave out what stays the same.",
    "Target bracket (Commander decks only): the Commander bracket the player means the deck for, 1–5 (1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH), or 0 for none. With one, get_deck warns when the cards go over it, and suggest_for_deck, similar_cards, budget_upgrades and search_for_deck leave out cards that would. Changing the format away from Commander clears it.",
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
    targetBracket: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe("The Commander bracket to aim for, 1–5, or 0 to clear it. Commander decks only."),
    grouping: z
      .enum(GROUPINGS)
      .optional()
      .describe(
        'How the deck list groups the main deck: "custom" by the deck\'s own headings, "type" by card type.',
      ),
  }),
  async run(context, input) {
    const result = await context.container.decks.updateDeck(context.actor, {
      deckId: DeckId.of(input.deckId),
      name: input.name,
      format: input.format,
      usesRealCards: input.usesRealCards,
      // 0 clears it: a plain number keeps the schema simple for small models (rule 9).
      targetBracket: input.targetBracket === 0 ? null : input.targetBracket,
      grouping: input.grouping,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "NameInvalid":
          return failed(
            "NameInvalid",
            `Give the deck a name of up to ${result.error.maximum} characters.`,
          );
        case "TargetBracketInvalid":
          return failed("TargetBracketInvalid", "A target bracket is 1, 2, 3, 4 or 5.");
        case "TargetBracketNotCommander":
          return failed(
            "TargetBracketNotCommander",
            "Only Commander decks have a target bracket. Change the format to commander first, or leave targetBracket out.",
          );
        default:
          return assertNever(result.error);
      }
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
    'Rules: cards you don\'t own may be added (they show as short); prefer owned cards, and free ones (search free>0) over cards another deck uses. To move a card from another deck, set it to 0 there (the player decides; ask first). To set a card aside without removing it, set it to 0 on "main" and add it on "maybe". Check the result with get_deck.',
    'Heading (optional): put the card under one of the deck\'s own headings ("Ramp"), or "" to take it off; leave it out to keep the current one. Main deck only. A new heading goes last.',
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
    heading: z
      .string()
      .max(200)
      .optional()
      .describe('A heading of the deck\'s own for the card, e.g. "Ramp"; "" removes it.'),
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
    if (input.heading !== undefined && input.quantity > 0) {
      const headed = await context.container.decks.setEntryHeading(context.actor, {
        deckId: DeckId.of(input.deckId),
        oracleId: found.oracleId,
        board: input.board,
        // "" clears it: a plain string keeps the schema simple for small models (rule 9).
        heading: input.heading === "" ? null : input.heading,
      });
      if (!headed.ok) {
        // The count was saved; only the heading wasn't.
        return failed(
          headed.error.kind,
          `The count was saved, but not the heading. ${HEADING_RULE}`,
        );
      }
    }
    return done({
      deckId: input.deckId,
      card: found.name,
      board: input.board,
      quantity: input.quantity,
      ...(input.heading !== undefined && input.quantity > 0 ? { heading: input.heading } : {}),
    });
  },
});

export const replaceDeckList = defineTool({
  name: "replace_deck_list",
  title: "Replace a deck's whole list",
  description: [
    "Replaces the deck's cards with a list in the usual text format, all or nothing.",
    "Use it when: making many changes at once. First call get_deck, edit its `list`, and send it back with the `fingerprint` get_deck gave.",
    'Inputs: list, with headings "Commander", "Deck", "Sideboard", "Maybeboard", the deck\'s own headings as "Ramp (9)" lines (as get_deck\'s list writes them when grouping is "custom"), and lines like "1 Sol Ring" or "1 Sol Ring (C21) 263" for a printing. A line without a printing keeps the printing the deck already has for that card; for a new card it uses your copy if you own one, otherwise the cheapest printing in the store (unnamedPrinting "cheapest", the default) or the card\'s standard printing ("standard").',
    "Returns: the new card count. If the deck changed since your get_deck (DeckChanged), call get_deck again and redo your edit. If some lines couldn't be used (ListProblems), nothing was saved: fix those lines.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    list: z.string().min(1).describe("The deck's complete new list."),
    fingerprint: z.string().min(1).describe("The fingerprint from your latest get_deck."),
    unnamedPrinting: z
      .enum(["cheapest", "standard"])
      .default("cheapest")
      .describe(
        'For an unowned line that names no printing: "cheapest" in the store, or the card\'s "standard" printing.',
      ),
  }),
  async run(context, input) {
    const result = await context.container.decks.replaceList(context.actor, {
      deckId: DeckId.of(input.deckId),
      text: input.list,
      fingerprint: input.fingerprint,
      unnamedPrinting: input.unnamedPrinting,
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

export const arrangeHeadings = defineTool({
  name: "arrange_headings",
  title: "Rename, merge, clear or order a deck's headings",
  description: [
    "Changes the deck's own headings (the groups the player sorts the main deck into, like \"Ramp\"; see get_deck's headings).",
    'Use it when: renaming a heading (from "Removal", to "Interaction"), merging one into another (to an existing heading), clearing one from every card (to ""), or putting them in a new order (order: every heading, once each). Give either from and to, or order.',
    "Rules: the player decides how their deck is organised; ask before reorganising it.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    from: z.string().max(200).optional().describe("The heading to rename, merge or clear."),
    to: z
      .string()
      .max(200)
      .optional()
      .describe('Its new name, another heading to merge it into, or "" to clear it.'),
    order: z
      .array(z.string().max(200))
      .max(MAX_HEADINGS)
      .optional()
      .describe("Every heading of the deck, once each, in the new order."),
  }),
  async run(context, input) {
    const { decks } = context.container;
    const id = DeckId.of(input.deckId);
    if ((input.from === undefined) === (input.order === undefined)) {
      return failed("InputInvalid", "Give either from and to, or order.");
    }
    if (input.from !== undefined) {
      if (input.to === undefined)
        return failed("InputInvalid", 'Say what to rename it to (or "" to clear it).');
      const result = await decks.renameHeading(context.actor, {
        deckId: id,
        from: input.from,
        to: input.to === "" ? null : input.to,
      });
      if (!result.ok) {
        switch (result.error.kind) {
          case "DeckNotFound":
            return deckNotFound(input.deckId);
          case "HeadingNotFound":
            return failed(
              "HeadingNotFound",
              `The deck has no heading "${input.from}": see get_deck.`,
            );
          case "HeadingInvalid":
            return failed("HeadingInvalid", HEADING_RULE);
          default:
            return assertNever(result.error);
        }
      }
      return done({ deckId: input.deckId, from: input.from, to: input.to });
    }
    const result = await decks.orderHeadings(context.actor, {
      deckId: id,
      order: input.order ?? [],
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "HeadingOrderInvalid":
          return failed(
            "HeadingOrderInvalid",
            "Name every heading the deck has (get_deck's headings), each once.",
          );
        default:
          return assertNever(result.error);
      }
    }
    return done({ deckId: input.deckId, order: input.order });
  },
});
