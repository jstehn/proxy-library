import { randomUUID } from "node:crypto";
import { z } from "zod";

const EDHREC_FRAMING =
  "Popularity data: shows what people play, not what is good. Inclusion % is not win rate.";
import {
  addDeckSource,
  BOARDS,
  checkNote,
  checkOwnedCards,
  CORE_DECK_TAGS,
  deckChangePreview,
  deckView,
  DeckId,
  findCard,
  FORMATS,
  getDeckProfile,
  GROUPINGS,
  isPlayed,
  resolveDeckProfileTargets,
  primerSections,
  updateDeckPrimer,
  updateDeckProfile,
  COST_REDUCER_SCOPES,
  type DeckPlan,
  isAvoidCard,
  isKeyCard,
  listDeckSources,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  MAX_NOTE_LENGTH,
  MAX_ROLE_LENGTH,
  MAX_QUANTITY,
  type DeckChange,
  type DeckChangePreview,
  type DeckProblem,
  type DeckView,
} from "@/modules/decks";
import { deckProfileFor } from "../avoid-cards";
import {
  bracketWarningText,
  estimateLabel,
  findingWithCards,
  problemText,
  TAG_LABELS,
} from "@/app/decks/labels";
import {
  cardNotFound,
  deckNotFound,
  defineTool,
  done,
  failed,
  money,
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

async function viewFor(context: ToolContext, id: number) {
  return deckView(context.container.db, context.actor.userId, id);
}

export const createDeck = defineTool({
  name: "create_deck",
  title: "Create a deck",
  description: [
    "Makes a new, empty deck and returns its id. Optionally fills it from a list in the usual text format.",
    'Use it when: the player wants a new deck. Then add cards with set_deck_entry, or pass a whole list here ("Commander" / "Deck" / "Sideboard" / "Maybeboard" headings, or headings of the player\'s own such as "Ramp (2)", then lines like "1 Sol Ring").',
    `Rules: cards you don't own may be added; they show as short. ${HEADING_RULE} (So "Lands (37)" or "Creatures (25)" are ignored as custom headings; use e.g. "Mana base" if you want a custom heading.)`,
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    name: z.string().min(1).max(60).describe("The deck's name, up to 60 characters."),
    format: z.enum(FORMATS).default("commander").describe("The deck's format."),
    targetBracket: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Optional Commander bracket target (1–5)."),
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
    if (input.targetBracket !== undefined) {
      await decks.updateDeck(context.actor, {
        deckId: created.value,
        targetBracket: input.targetBracket as 1 | 2 | 3 | 4 | 5,
      });
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
    "Target bracket (Commander decks only): the Commander bracket the player means the deck for, 1–5 (1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH), or 0 for none. With one, get_deck warns when the cards go over it, and idea_candidates, similar_cards, idea_budget_upgrades and search_for_deck leave out cards that would. Changing the format away from Commander clears it.",
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

export const deleteDeckTool = defineTool({
  name: "delete_deck",
  title: "Delete a deck",
  description: [
    "Permanently deletes a deck and all of its entries, sources, and snapshots. Requires confirm: true.",
    "Use it when: cleaning up an old or duplicate test deck after the user asks to remove it.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    confirm: z.boolean().default(false).describe("Must be true to permanently delete the deck."),
  }),
  async run(context, input) {
    if (!input.confirm) {
      return failed("ConfirmationRequired", "Pass confirm: true to permanently delete this deck.");
    }
    const result = await context.container.decks.deleteDeck(context.actor, DeckId.of(input.deckId));
    if (!result.ok) return deckNotFound(input.deckId);
    return done({ deckId: input.deckId, deleted: true });
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

const roundTwo = (value: number) => Math.round(value * 100) / 100;

function summarizeRemainingProblems(problems: readonly DeckProblem[]): string[] {
  const nonShort = problems.filter((p) => p.kind !== "Short").map(problemText);
  const shortCount = problems.length - nonShort.length;
  if (shortCount <= 5) return problems.map(problemText);
  return [...nonShort, `${shortCount} short card(s) (see shortTotal / deck_facts)`];
}

function formatPreviewResponse(
  preview: DeckChangePreview,
  saved: Readonly<{ saved: boolean; fingerprint: string }>,
) {
  return {
    deck: preview.deck,
    format: preview.format,
    targetSize: preview.targetSize,
    saved: saved.saved,
    fingerprint: saved.fingerprint,
    changes: preview.changes.map((change) => ({
      card: change.name,
      board: change.board,
      before: change.beforeQuantity,
      after: change.afterQuantity,
    })),
    before: {
      cardCount: preview.before.stats.cardCount,
      lands: preview.before.stats.lands,
      otherManaSources: preview.before.stats.otherManaSources,
      averageManaValue: roundTwo(preview.before.stats.averageManaValue),
      curve: preview.before.stats.curve,
      pips: preview.before.stats.pips,
      sources: preview.before.stats.sources,
      value: money(preview.before.stats.priceCents),
      shortTotal: preview.before.shortTotal,
    },
    after: {
      cardCount: preview.after.stats.cardCount,
      lands: preview.after.stats.lands,
      otherManaSources: preview.after.stats.otherManaSources,
      averageManaValue: roundTwo(preview.after.stats.averageManaValue),
      curve: preview.after.stats.curve,
      pips: preview.after.stats.pips,
      sources: preview.after.stats.sources,
      value: money(preview.after.stats.priceCents),
      shortTotal: preview.after.shortTotal,
    },
    priceDelta: money(preview.priceDeltaCents),
    roles: preview.roles
      .filter((role) => role.before !== role.after || role.target !== null)
      .map((role) => ({
        role: role.tag,
        label: TAG_LABELS[role.tag],
        before: role.before,
        after: role.after,
        target: role.target,
        ...(role.added.length > 0 ? { added: role.added } : {}),
        ...(role.removed.length > 0 ? { removed: role.removed } : {}),
      })),
    newlyMetRoles: preview.newlyMetRoles,
    newlyMissedRoles: preview.newlyMissedRoles,
    problems: {
      added: preview.problems.added.map(problemText),
      resolved: preview.problems.resolved.map(problemText),
      remaining: summarizeRemainingProblems(preview.problems.remaining),
    },
    newlyShort: preview.newlyShort.map((short) => ({
      card: short.name,
      needed: short.needed,
      owned: short.owned,
      missing: short.needed - short.owned,
    })),
    bracket:
      preview.bracket.before === null || preview.bracket.after === null
        ? null
        : {
            target: preview.targetBracket,
            before: estimateLabel(preview.bracket.before),
            after: estimateLabel(preview.bracket.after),
            findingsAfter: preview.bracket.after.findings.map(findingWithCards),
            overTargetAfter:
              preview.bracket.warningAfter === null
                ? null
                : bracketWarningText(preview.bracket.warningAfter),
          },
  };
}

function previewGuardrailWarnings(
  view: DeckView | null,
  profile: DeckPlan | null,
  preview: DeckChangePreview,
): string[] {
  const warnings: string[] = [];
  for (const change of preview.changes) {
    if (!isPlayed(change.board)) continue;
    const line = view?.lines.find(
      (l) => l.name.toLowerCase() === change.name.toLowerCase() && l.board === change.board,
    );
    const pinned = line?.pinned === true;
    if (change.afterQuantity < change.beforeQuantity && isKeyCard(change.name, profile, pinned)) {
      const reason = profile?.keyCards.find(
        (k) => k.cardName.toLowerCase() === change.name.toLowerCase(),
      )?.reason;
      warnings.push(
        `Cutting ${pinned ? "pinned " : ""}keyCard: ${change.name} (${change.board} ${change.beforeQuantity} -> ${change.afterQuantity})${reason ? ` — ${reason}` : ""}`,
      );
    }
    if (change.afterQuantity > change.beforeQuantity && isAvoidCard(change.name, profile)) {
      const reason = profile?.avoid.find(
        (a) => a.cardName.toLowerCase() === change.name.toLowerCase(),
      )?.reason;
      warnings.push(`Adding avoid card: ${change.name}${reason ? ` — ${reason}` : ""}`);
    }
  }
  return warnings;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;

type StoredPreview = {
  userId: string;
  deckId: number;
  fingerprint: string;
  changesToSave: Array<{
    oracleId: string;
    board: (typeof BOARDS)[number];
    quantity?: number;
    note?: string | null;
    heading?: string | null;
    tags?: readonly string[];
    role?: string | null;
    pinned?: boolean;
  }>;
  preview: DeckChangePreview;
  expiresAtMs: number;
};

const pendingPreviews = new Map<string, StoredPreview>();

export const applyChangesTool = defineTool({
  name: "apply_changes",
  title: "Preview or apply a batch of changes to a deck",
  description: [
    "Pre-evaluates (and optionally saves) a batch of card changes to a deck: returns before/after for card count, curve, average mana value, roles vs targets, colors, Commander bracket, problems added/resolved/remaining, newly short cards, price difference, fingerprint, and a previewId. Each change can set quantity (0 removes; omit to update only note/heading/tags/role/pinned on an existing line), note, heading, tags, role (one-line job) and pinned.",
    "Use it when: testing swaps, cuts or additions before changing the player's deck, or applying multiple changes/notes/headings/tags at once. Leave save false (the default) to preview first, then save without resending changes by calling with { deckId, previewId, save: true } (or pass changes + fingerprint).",
    'Rules: all card names must match the catalog or nothing is previewed or saved. To move a card to the maybeboard, send two changes: 0 on "main" and its count on "maybe".',
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    changes: z
      .array(
        z.object({
          card,
          quantity: z
            .number()
            .int()
            .min(0)
            .max(MAX_QUANTITY)
            .optional()
            .describe(
              "How many copies the deck should have on this board (0 removes); omit to keep existing quantity when updating note, heading, or tags.",
            ),
          board,
          note: z
            .string()
            .max(400)
            .optional()
            .describe(
              `Optional note explaining why this card is in the deck (up to ${MAX_NOTE_LENGTH} chars); "" clears it.`,
            ),
          heading: z
            .string()
            .max(200)
            .optional()
            .describe('Optional custom heading (e.g. "Ramp"); "" clears it.'),
          tags: z
            .array(z.string().min(1).max(40))
            .max(20)
            .optional()
            .describe(
              `Optional structured tags (prefer core tags: ${CORE_DECK_TAGS.join(", ")}; custom tags like "Blitz" allowed up to 25 distinct tags/deck); [] clears them.`,
            ),
          role: z
            .string()
            .max(MAX_ROLE_LENGTH)
            .optional()
            .describe(
              'Optional one-line job of this card in the deck (e.g. "Free sac outlet for Avacyn"); "" clears it.',
            ),
          pinned: z
            .boolean()
            .optional()
            .describe("Pin the card: tools never suggest cutting or replacing a pinned card."),
        }),
      )
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Changes to preview or save (1 to 100 entries). Optional when saving with previewId.",
      ),
    save: z
      .boolean()
      .default(false)
      .describe(
        "False (the default) previews without saving; true saves all changes if fingerprint/previewId matches.",
      ),
    fingerprint: z
      .string()
      .optional()
      .describe(
        "Required when save is true without previewId: the fingerprint from get_deck or a preview.",
      ),
    previewId: z
      .string()
      .optional()
      .describe(
        "Optional previewId from a prior save: false call to commit without resending changes.",
      ),
  }),
  async run(context, input) {
    const nowMs = context.container.clock.now().getTime();
    for (const [id, item] of pendingPreviews.entries()) {
      if (item.expiresAtMs <= nowMs) pendingPreviews.delete(id);
    }

    if (input.save && input.previewId && (!input.changes || input.changes.length === 0)) {
      const stored = pendingPreviews.get(input.previewId);
      if (
        !stored ||
        stored.userId !== context.actor.userId ||
        stored.deckId !== input.deckId ||
        stored.expiresAtMs <= nowMs
      ) {
        return failed(
          "PreviewExpired",
          "That previewId is missing or expired. Preview the changes again.",
        );
      }
      const fp = input.fingerprint ?? stored.fingerprint;
      const result = await context.container.decks.applyChanges(context.actor, {
        deckId: DeckId.of(input.deckId),
        fingerprint: fp,
        changes: stored.changesToSave,
      });
      if (!result.ok) {
        switch (result.error.kind) {
          case "DeckNotFound":
            return deckNotFound(input.deckId);
          case "DeckChanged":
            return failed(
              "DeckChanged",
              "The deck changed since that preview. Preview again without saving.",
            );
          case "QuantityInvalid":
            return failed("QuantityInvalid", `Use 0 to ${result.error.maximum} copies.`);
          case "CardNotFound":
            return cardNotFound("one of the changed cards");
          case "NoteInvalid":
            return failed(
              "NoteInvalid",
              `Line notes must be 1 to ${result.error.maximum} characters (or "" to clear).`,
            );
          case "HeadingInvalid":
            return failed("HeadingInvalid", HEADING_RULE);
        }
      }
      pendingPreviews.delete(input.previewId);
      return done(
        formatPreviewResponse(stored.preview, {
          saved: true,
          fingerprint: result.value.fingerprint,
        }),
      );
    }

    if (!input.changes || input.changes.length === 0) {
      return failed("InputInvalid", "Pass changes (or a previewId with save: true).");
    }

    const saveFingerprint = input.fingerprint ?? "";
    if (input.save && saveFingerprint === "") {
      return failed(
        "InputInvalid",
        "Pass the fingerprint from get_deck or a prior preview (or previewId) when save is true.",
      );
    }
    const uniqueNames = [...new Set(input.changes.map((entry) => entry.card))];
    const resolvedEntries = await Promise.all(
      uniqueNames.map(async (name) => [name, await findCard(context.container.db, name)] as const),
    );
    const byName = new Map<string, string>();
    const missing: string[] = [];
    for (const [name, found] of resolvedEntries) {
      if (found === null) missing.push(name);
      else byName.set(name, found.oracleId);
    }
    if (missing.length > 0) {
      return failed(
        "CardNotFound",
        `Cards not in the catalog (nothing previewed or saved): ${missing.join(", ")}.`,
      );
    }

    for (const entry of input.changes) {
      if ((entry.quantity ?? 1) > 0 && entry.note !== undefined && entry.note !== "") {
        const checked = checkNote(entry.note);
        if (!checked.ok) {
          return failed(
            "NoteInvalid",
            `Line note for ${entry.card} must be 1 to ${checked.error.maximum} characters (or "" to clear).`,
          );
        }
      }
    }

    let existingView: DeckView | null = null;
    if (input.changes.some((c) => c.quantity === undefined)) {
      existingView = await viewFor(context, input.deckId);
      if (existingView === null) return deckNotFound(input.deckId);
    }

    const resolvedChanges: DeckChange[] = [];
    const changesToSave: StoredPreview["changesToSave"] = [];
    for (const entry of input.changes) {
      const oracleId = byName.get(entry.card);
      if (oracleId === undefined) continue;
      let resolvedQty = entry.quantity;
      if (resolvedQty === undefined) {
        const existingLine = existingView?.lines.find(
          (l) => l.oracleId === oracleId && l.board === entry.board,
        );
        if (!existingLine) {
          return failed(
            "QuantityInvalid",
            `${entry.card} is not on the ${entry.board} board; pass quantity to add it.`,
          );
        }
        resolvedQty = existingLine.quantity;
      }
      resolvedChanges.push({ oracleId, board: entry.board, quantity: resolvedQty });
      changesToSave.push({
        oracleId,
        board: entry.board,
        quantity: resolvedQty,
        ...(entry.note !== undefined && resolvedQty > 0
          ? { note: entry.note === "" ? null : entry.note }
          : {}),
        ...(entry.heading !== undefined && resolvedQty > 0
          ? { heading: entry.heading === "" ? null : entry.heading }
          : {}),
        ...(entry.tags !== undefined && resolvedQty > 0 ? { tags: entry.tags } : {}),
        ...(entry.role !== undefined && resolvedQty > 0
          ? { role: entry.role === "" ? null : entry.role }
          : {}),
        ...(entry.pinned !== undefined && resolvedQty > 0 ? { pinned: entry.pinned } : {}),
      });
    }

    const preview = await deckChangePreview(
      context.container.db,
      context.actor.userId,
      input.deckId,
      resolvedChanges,
    );
    if (preview === null) return deckNotFound(input.deckId);

    const [guardrailView, guardrailProfile] = await Promise.all([
      existingView !== null ? Promise.resolve(existingView) : viewFor(context, input.deckId),
      deckProfileFor(context, input.deckId),
    ]);
    const warnings = previewGuardrailWarnings(guardrailView, guardrailProfile, preview);

    if (!input.save) {
      const previewId = randomUUID();
      pendingPreviews.set(previewId, {
        userId: context.actor.userId,
        deckId: input.deckId,
        fingerprint: preview.fingerprint,
        changesToSave,
        preview,
        expiresAtMs: nowMs + PREVIEW_TTL_MS,
      });
      return done({
        ...formatPreviewResponse(preview, { saved: false, fingerprint: preview.fingerprint }),
        ...(warnings.length > 0 ? { warnings } : {}),
        previewId,
      });
    }

    const result = await context.container.decks.applyChanges(context.actor, {
      deckId: DeckId.of(input.deckId),
      fingerprint: saveFingerprint,
      changes: changesToSave,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "DeckChanged":
          return failed(
            "DeckChanged",
            "The deck changed since that fingerprint. Preview again without saving to get the new fingerprint.",
          );
        case "QuantityInvalid":
          return failed("QuantityInvalid", `Use 0 to ${result.error.maximum} copies.`);
        case "CardNotFound":
          return cardNotFound("one of the changed cards");
        case "NoteInvalid":
          return failed(
            "NoteInvalid",
            `Line notes must be 1 to ${result.error.maximum} characters (or "" to clear).`,
          );
        case "HeadingInvalid":
          return failed("HeadingInvalid", HEADING_RULE);
      }
    }

    return done({
      ...formatPreviewResponse(preview, { saved: true, fingerprint: result.value.fingerprint }),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
});

export const edhrecCommanderTool = defineTool({
  name: "edhrec_commander",
  title: "Fetch EDHREC commander data",
  description: [
    "Fetches EDHREC's JSON data for a commander (cached 24 hours): deck count, theme tags with counts, cards with inclusion %, synergy score and EDHREC category, average decklist (if available), and source URL.",
    "Use it when: gathering outside popularity data for a commander before judging cards by their rules text.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    commander: z.string().min(1).describe("The commander's English name."),
    theme: z
      .string()
      .min(1)
      .optional()
      .describe('Optional EDHREC theme slug or name (e.g. "reanimator").'),
    budget: z
      .enum(["budget", "expensive"])
      .optional()
      .describe("Optional EDHREC budget filter: budget or expensive."),
    category: z
      .string()
      .min(1)
      .optional()
      .describe('Optional category filter (e.g. "High Synergy Cards", "Creatures").'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(60)
      .describe("Maximum number of cards to return (default 60, max 200)."),
  }),
  async run(context, input) {
    let data;
    try {
      data = await context.container.outsideData.fetchEdhrecCommander(input.commander, {
        theme: input.theme,
        budget: input.budget,
      });
    } catch (error) {
      return failed(
        "EdhrecUnavailable",
        `Could not reach EDHREC: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
    if (data === null) {
      return failed("EdhrecNotFound", `No EDHREC page found for "${input.commander}".`);
    }
    const filteredCards = input.category
      ? data.cards.filter((c) => c.category.toLowerCase() === input.category?.toLowerCase())
      : data.cards;
    return done({
      framing: EDHREC_FRAMING,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      cached: data.cached,
      commander: data.commander,
      deckCount: data.deckCount,
      population: {
        deckCount: data.deckCount,
        bracket: "all-bracket",
        theme: input.theme ?? null,
        note: `Percentages come from ${data.deckCount.toLocaleString("en-US")} ${input.theme ? `${input.theme} ` : ""}decks across all brackets on EDHREC (not filtered to a single Commander bracket).`,
      },
      themes: data.themes.slice(0, 20),
      totalCards: filteredCards.length,
      cards: filteredCards.slice(0, input.limit),
      averageDecklist: data.averageDecklist,
    });
  },
});

export const compareToEdhrecTool = defineTool({
  name: "compare_to_edhrec",
  title: "Compare a deck to EDHREC popularity data",
  description: [
    "Compares a Commander deck against EDHREC data for its commander (cached 24 hours), all unranked and sorted alphabetically with no cut/add verdicts: your cards with inclusion % & synergy, high-inclusion EDHREC cards you don't run (with owned flag), and your cards EDHREC doesn't list.",
    "Use it when: seeing where a deck differs from the crowd without treating popularity as a verdict.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    theme: z.string().min(1).optional().describe('Optional EDHREC theme (e.g. "reanimator").'),
  }),
  async run(context, input) {
    const [view, storedProfile] = await Promise.all([
      deckView(context.container.db, context.actor.userId, input.deckId),
      getDeckProfile(context.container.db, context.actor.userId, input.deckId),
    ]);
    if (view === null) return deckNotFound(input.deckId);

    const commanders = view.lines.filter((l) => l.board === "commander");
    const commander = commanders[0];
    if (!commander) {
      return failed(
        "CommanderMissing",
        "Put a commander on the commander board first before calling compare_to_edhrec.",
      );
    }
    const commanderName = commander.name;

    let data;
    try {
      data = await context.container.outsideData.fetchEdhrecCommander(commanderName, {
        theme: input.theme,
      });
    } catch (error) {
      return failed(
        "EdhrecUnavailable",
        `Could not reach EDHREC: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
    if (data === null) {
      return failed("EdhrecNotFound", `No EDHREC page found for "${commanderName}".`);
    }

    const edhrecByLower = new Map<string, (typeof data.cards)[number]>();
    for (const card of data.cards) {
      edhrecByLower.set(card.name.toLowerCase(), card);
      const front = card.name.split(" // ")[0]?.toLowerCase();
      if (front && !edhrecByLower.has(front)) edhrecByLower.set(front, card);
    }

    const playedLines = view.lines.filter((l) => isPlayed(l.board) && l.board !== "commander");
    const deckCardKeys = new Set<string>();
    for (const line of playedLines) {
      deckCardKeys.add(line.name.toLowerCase());
      const front = line.name.split(" // ")[0]?.toLowerCase();
      if (front) deckCardKeys.add(front);
    }

    const inDeckWithEdhrec: {
      name: string;
      inclusionPct: number;
      synergy: number;
      category: string;
    }[] = [];
    const inDeckNotOnEdhrec: { name: string; typeLine: string }[] = [];

    for (const line of playedLines) {
      const match =
        edhrecByLower.get(line.name.toLowerCase()) ??
        edhrecByLower.get(line.name.split(" // ")[0]?.toLowerCase() ?? "");
      if (match) {
        inDeckWithEdhrec.push({
          name: line.name,
          inclusionPct: match.inclusionPct,
          synergy: match.synergy,
          category: match.category,
        });
      } else if (!line.isBasicLand) {
        inDeckNotOnEdhrec.push({ name: line.name, typeLine: line.typeLine });
      }
    }

    const leftOutAvoid: string[] = [];
    const notInDeckCandidates = data.cards.filter((card) => {
      const lower = card.name.toLowerCase();
      const front = lower.split(" // ")[0] ?? lower;
      if (deckCardKeys.has(lower) || deckCardKeys.has(front)) return false;
      if (isAvoidCard(card.name, storedProfile?.profile)) {
        leftOutAvoid.push(card.name);
        return false;
      }
      return true;
    });
    const highInclusion = notInDeckCandidates.filter((c) => c.inclusionPct >= 20).slice(0, 60);
    const missingPool =
      highInclusion.length > 0
        ? highInclusion
        : [...notInDeckCandidates].sort((a, b) => b.inclusionPct - a.inclusionPct).slice(0, 30);

    const ownedChecks =
      missingPool.length > 0
        ? await checkOwnedCards(
            context.container.db,
            context.actor.userId,
            missingPool.map((c) => c.name),
          )
        : [];
    const ownedByQuery = new Map(ownedChecks.map((c) => [c.query.toLowerCase(), c]));

    const highInclusionNotInDeck = missingPool
      .map((card) => {
        const check = ownedByQuery.get(card.name.toLowerCase());
        const owned = check && check.inCatalog ? check.ownedTotal > 0 : false;
        return {
          name: card.name,
          inclusionPct: card.inclusionPct,
          synergy: card.synergy,
          category: card.category,
          inCatalog: check ? check.inCatalog : false,
          owned,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    inDeckWithEdhrec.sort((a, b) => a.name.localeCompare(b.name));
    inDeckNotOnEdhrec.sort((a, b) => a.name.localeCompare(b.name));

    return done({
      framing: EDHREC_FRAMING,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      cached: data.cached,
      commander: data.commander,
      deckCount: data.deckCount,
      population: {
        deckCount: data.deckCount,
        bracket: "all-bracket",
        theme: input.theme ?? null,
        note: `Percentages come from ${data.deckCount.toLocaleString("en-US")} ${input.theme ? `${input.theme} ` : ""}decks across all brackets on EDHREC (not filtered to a single Commander bracket).`,
      },
      inDeckWithEdhrec,
      highInclusionNotInDeck,
      inDeckNotOnEdhrec,
      ...(leftOutAvoid.length > 0 ? { leftOutAvoid: [...new Set(leftOutAvoid)].sort() } : {}),
    });
  },
});

export const deckSourcesTool = defineTool({
  name: "deck_sources",
  title: "Save or list research sources for a deck",
  description: [
    "Saves an outside research source (URL, title, what it was used for) onto a deck and returns all saved sources, or lists them when url is omitted.",
    "Use it when: recording EDHREC pages, guides, primers, or Spellbook/Scryfall links used for a deck so later sessions don't redo the research.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    url: z.string().url().optional().describe("Optional source URL to save."),
    title: z.string().min(1).max(200).optional().describe("Title of the source."),
    usedFor: z
      .string()
      .max(500)
      .optional()
      .describe("What this source was used for (e.g. 'blitz rulings, mana base targets')."),
  }),
  async run(context, input) {
    if (input.url !== undefined) {
      const sources = await addDeckSource(
        context.container.db,
        context.actor.userId,
        input.deckId,
        {
          url: input.url,
          title: input.title ?? input.url,
          usedFor: input.usedFor ?? "",
        },
        context.container.clock.now(),
      );
      if (sources === null) return deckNotFound(input.deckId);
      const added = sources.find((s) => s.url === input.url) ?? sources[sources.length - 1] ?? null;
      return done({ deckId: input.deckId, source: added, totalCount: sources.length });
    }
    const sources = await listDeckSources(context.container.db, context.actor.userId, input.deckId);
    if (sources === null) return deckNotFound(input.deckId);
    return done({ deckId: input.deckId, sources });
  },
});

const costReducerSchema = z.object({
  cardName: z.string().min(1),
  scope: z.enum(COST_REDUCER_SCOPES),
  genericReduction: z.number().int().min(0).max(20),
  perCommandCast: z.boolean().optional(),
  minManaValue: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Optional minimum base mana value required (e.g. 4 for Henzie)."),
  minPower: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Optional minimum creature power required (e.g. 4 for Goreclaw)."),
});

const keyCardPinSchema = z.object({
  cardName: z.string().min(1),
  reason: z.string().min(1).max(200),
});

const avoidCardSchema = z.object({
  cardName: z.string().min(1),
  reason: z.string().min(1).max(200),
});

export const setDeckProfileTool = defineTool({
  name: "set_deck_profile",
  title: "Update deck profile",
  description: [
    "Patches structured fields on a deck's profile (plan, landTarget, roleTargets, keyCards, avoid, costReducers, winCons, declaredCombos, mulligan, pilotNotes).",
    "Use it when: recording the deck's plan, pinning keyCards, ruling out avoid cards, or setting commander costReducers and custom land/role targets.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    plan: z
      .string()
      .max(1000)
      .optional()
      .describe("One or two sentences describing the deck's plan."),
    landTarget: z
      .number()
      .int()
      .min(0)
      .max(99)
      .optional()
      .describe("Target land count for the deck."),
    roleTargets: z
      .object({
        ramp: z.number().int().min(0).max(99).optional(),
        draw: z.number().int().min(0).max(99).optional(),
        removal: z.number().int().min(0).max(99).optional(),
        wipe: z.number().int().min(0).max(99).optional(),
      })
      .optional()
      .describe("Target counts for ramp, draw, removal, and wipe."),
    keyCards: z
      .array(keyCardPinSchema)
      .max(50)
      .optional()
      .describe(
        "Pinned key cards with a one-line reason (never suggested for cut or replacement).",
      ),
    avoid: z
      .array(avoidCardSchema)
      .max(100)
      .optional()
      .describe("Ruled-out cards with reasons; excluded by search and idea tools."),
    costReducers: z
      .array(costReducerSchema)
      .max(20)
      .optional()
      .describe(
        'Declarative cost reducers (e.g. Henzie: scope "creatures", minManaValue 4, genericReduction 1, perCommandCast true; Goreclaw: scope "creatures", minPower 4, genericReduction 2; Electromancer: scope "instants_sorceries", genericReduction 1).',
      ),
    winCons: z
      .array(z.string().min(1).max(300))
      .max(20)
      .optional()
      .describe("Win condition lines."),
    declaredCombos: z
      .array(z.string().min(1).max(300))
      .max(30)
      .optional()
      .describe("Declared combos for bracket disclosure."),
    mulligan: z.string().max(1000).optional().describe("Short mulligan heuristic."),
    pilotNotes: z.string().max(2000).optional().describe("Short pilot notes."),
  }),
  async run(context, input) {
    const patch: Partial<DeckPlan> = {};
    if (input.plan !== undefined) patch.plan = input.plan;
    if (input.landTarget !== undefined) patch.landTarget = input.landTarget;
    if (input.roleTargets !== undefined) patch.roleTargets = input.roleTargets;
    if (input.keyCards !== undefined) patch.keyCards = input.keyCards;
    if (input.avoid !== undefined) patch.avoid = input.avoid;
    if (input.costReducers !== undefined) patch.costReducers = input.costReducers;
    if (input.winCons !== undefined) patch.winCons = input.winCons;
    if (input.declaredCombos !== undefined) patch.declaredCombos = input.declaredCombos;
    if (input.mulligan !== undefined) patch.mulligan = input.mulligan;
    if (input.pilotNotes !== undefined) patch.pilotNotes = input.pilotNotes;

    const updated = await updateDeckProfile(
      context.container.db,
      context.actor.userId,
      input.deckId,
      patch,
      context.container.clock.now(),
    );
    if (!updated) return deckNotFound(input.deckId);

    const warnings: string[] = [];
    if (input.keyCards !== undefined || input.avoid !== undefined) {
      const view = await viewFor(context, input.deckId);
      const deckNames = new Set(
        (view?.lines ?? []).flatMap((l) => [
          l.name.toLowerCase(),
          ...l.name.split(" // ").map((f) => f.toLowerCase()),
        ]),
      );
      const playedNames = new Set(
        (view?.lines ?? [])
          .filter((l) => isPlayed(l.board))
          .flatMap((l) => [
            l.name.toLowerCase(),
            ...l.name.split(" // ").map((f) => f.toLowerCase()),
          ]),
      );
      const namesToCheck = [
        ...(input.keyCards ?? []).map((k) => k.cardName),
        ...(input.avoid ?? []).map((a) => a.cardName),
      ];
      const resolved = new Map(
        await Promise.all(
          [...new Set(namesToCheck)].map(
            async (name) => [name, await findCard(context.container.db, name)] as const,
          ),
        ),
      );
      for (const entry of input.keyCards ?? []) {
        const found = resolved.get(entry.cardName);
        if (!found) {
          warnings.push(`Unknown card in keyCards: "${entry.cardName}" (not in catalog).`);
        } else if (view && !deckNames.has(found.name.toLowerCase())) {
          warnings.push(`keyCard "${found.name}" is not currently in this deck.`);
        }
      }
      for (const entry of input.avoid ?? []) {
        const found = resolved.get(entry.cardName);
        if (!found) {
          warnings.push(`Unknown card in avoid: "${entry.cardName}" (not in catalog).`);
        } else if (view && playedNames.has(found.name.toLowerCase())) {
          warnings.push(`avoid card "${found.name}" is currently in this deck.`);
        }
      }
    }

    return done({
      deckId: updated.deckId,
      profile: updated.profile,
      resolvedTargets: resolveDeckProfileTargets(updated.profile),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
});

export const setPrimerTool = defineTool({
  name: "set_primer",
  title: "Update deck primer",
  description: [
    "Updates a deck's Markdown primer, either patching a single `## Section` heading or replacing the full primer when `section` is omitted. Supports `[[Card Name]]` links.",
    "Use it when: writing or updating a section (e.g. Plan, How it wins, Key cards, Mulligan, Turns 1–3, Watch out for).",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    section: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe(
        "Optional ## heading name to patch in place, or to add at the end (omit to replace the entire primer).",
      ),
    content: z
      .string()
      .max(20000)
      .describe(
        'Markdown for the section (without its "## " heading) or for the full primer; "" removes the section (or clears the primer).',
      ),
  }),
  async run(context, input) {
    const updated = await updateDeckPrimer(
      context.container.db,
      context.actor.userId,
      input.deckId,
      { section: input.section, content: input.content },
      context.container.clock.now(),
    );
    if (!updated) return deckNotFound(input.deckId);

    const warnings: string[] = [];
    const linkMatches = [...updated.primer.matchAll(/\[\[([^\]]+)\]\]/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((name) => name.length > 0);
    const uniqueLinks = [...new Set(linkMatches)];
    if (uniqueLinks.length > 0) {
      const view = await viewFor(context, input.deckId);
      const deckNames = new Set(
        (view?.lines ?? []).flatMap((l) => [
          l.name.toLowerCase(),
          ...l.name.split(" // ").map((f) => f.toLowerCase()),
        ]),
      );
      const missingFromDeck = uniqueLinks.filter((name) => !deckNames.has(name.toLowerCase()));
      if (missingFromDeck.length > 0) {
        const resolved = await Promise.all(
          missingFromDeck.map(
            async (name) => [name, await findCard(context.container.db, name)] as const,
          ),
        );
        for (const [name, found] of resolved) {
          if (!found) {
            warnings.push(`[[${name}]] in primer was not found in the card catalog.`);
          } else if (!deckNames.has(found.name.toLowerCase())) {
            warnings.push(`[[${found.name}]] in primer is not currently in this deck.`);
          }
        }
      }
    }

    return done({
      deckId: updated.deckId,
      primerSections: primerSections(updated.primer),
      characters: updated.primer.length,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
});
