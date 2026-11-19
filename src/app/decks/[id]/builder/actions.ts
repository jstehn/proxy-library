"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type PrintingCard, PrintingId, printingCards } from "@/modules/catalog";
import {
  BOARDS,
  BROWSE_SORTS,
  BROWSE_SOURCES,
  browseCollection,
  budgetList,
  cardPrintings,
  type PrintingOption,
  type DeckCombo,
  deckSuggestions,
  draftForDeck,
  type DeckDraft,
  type ManaBasePlan,
  optimizeDeckForView,
  type OptimizeDeckPool,
  type OptimizeResult,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
  type SuggestionList,
  DeckId,
  deckView,
  fingerprint,
  GROUPINGS,
  listDeckSnapshots,
  MAX_ROLE_LENGTH,
  compareDeckSnapshot,
  SnapshotId,
  type SnapshotComparison,
  type SnapshotSummary,
  type TokenLine,
  type Grouping,
  type BrowsePage,
  type CardRules,
  type DeckLine,
  otherDecksHolding,
  type OtherDeckUse,
  takeCopies,
  type DeckPlan,
  describeDeckError,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ColorSchema, FinishSchema } from "@/shared/kernel";

// The deck builder's server side (design doc 14). The browser holds the deck in memory for
// instant statistics and problems (design doc 19); every change goes through the decks module,
// and the fresh deck comes back.

const BrowseInput = z.object({
  deckId: z.number().int().positive(),
  source: z.enum(BROWSE_SOURCES),
  search: z.string().max(400),
  colors: z.array(ColorSchema).max(5).nullable(),
  includeColorless: z.boolean(),
  onlyLegal: z.boolean(),
  sort: z.enum(BROWSE_SORTS),
  page: z.number().int().min(1).max(1000),
});

/** One page of your collection (or of every card for sale), filtered and sorted for this deck. */
export async function browseAction(input: z.input<typeof BrowseInput>): Promise<BrowsePage | null> {
  const actor = await requireActor();
  const parsed = BrowseInput.safeParse(input);
  if (!parsed.success) return null;
  return browseCollection(getContainer().db, actor.userId, parsed.data);
}

/** A card's details for the selected-card panel and previews. */
export async function cardDetailAction(printingId: string): Promise<PrintingCard | null> {
  await requireActor();
  if (!/^[0-9a-f-]{36}$/.test(printingId)) return null;
  const cards = await printingCards(getContainer().db, [printingId]);
  return cards.get(printingId) ?? null;
}

/** The deck as the builder shows it, with what the browser needs to check its rules. */
export type BuilderDeck = Readonly<{
  lines: DeckLine[];
  /** The rules facts of every card in the deck, for `deckProblems` in the browser. */
  rules: Record<string, CardRules>;
  /** Card details for every line, for name previews. */
  cards: Record<string, PrintingCard>;
  /** By type or by the deck's own headings, and those headings in order (design doc 34). */
  grouping: Grouping;
  headings: string[];
  /** Two-card combos detected in the deck (design doc 52), or undefined if not synced. */
  combos?: readonly DeckCombo[];
}>;

/** Loads the deck for the builder. */
export async function loadBuilderDeck(deckId: number): Promise<BuilderDeck | null> {
  const actor = await requireActor();
  const result = await getContainer().capabilities.deckOverview({
    userId: actor.userId,
    deckId,
    parts: { printings: true },
  });
  if (!result.ok) return null;
  const { view, printings, combos } = result.value;
  return {
    lines: view.lines,
    rules: { ...view.rules },
    cards: Object.fromEntries(printings ?? []),
    grouping: view.deck.grouping,
    headings: [...view.deck.headings],
    combos,
  };
}

const QuantityInput = z.object({
  deckId: z.number().int().positive(),
  oracleId: z.string().min(1),
  printingId: z.string().min(1).optional(),
  board: z.enum(BOARDS),
  quantity: z.number().int().min(0).max(99),
});

export type QuantityResult = { ok: true; deck: BuilderDeck } | { ok: false; message: string };

/** Sets how many of a card are on one board (0 removes it), and returns the fresh deck. */
export async function setQuantityAction(
  input: z.input<typeof QuantityInput>,
): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = QuantityInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const { deckId, oracleId, printingId, board, quantity } = parsed.data;
  const result = await getContainer().decks.setEntry(actor, {
    deckId: DeckId.of(deckId),
    oracleId,
    board,
    quantity,
    printingId: printingId ? PrintingId.of(printingId) : undefined,
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const deck = await loadBuilderDeck(deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

const DeckIdInput = z.number().int().positive();

const MoveInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  from: z.enum(BOARDS),
  to: z.enum(BOARDS),
});

/** Moves a card's line to another board, such as the maybeboard and back (design doc 32). */
export async function moveLineAction(input: z.input<typeof MoveInput>): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = MoveInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const result = await getContainer().decks.moveEntry(actor, {
    ...parsed.data,
    deckId: DeckId.of(parsed.data.deckId),
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const deck = await loadBuilderDeck(parsed.data.deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

const SwapInput = z.object({
  deckId: DeckIdInput,
  cutOracleId: z.string().min(1),
  addOracleId: z.string().min(1),
});

/** Atomically moves 1 copy of a cut card to the maybeboard and adds 1 copy of its replacement to main. */
export async function swapCardsAction(input: z.input<typeof SwapInput>): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = SwapInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That swap wasn't understood." };
  const { deckId, cutOracleId, addOracleId } = parsed.data;
  const view = await deckView(getContainer().db, actor.userId, deckId);
  if (view === null) return { ok: false, message: "That deck isn't yours." };

  const cutMainQty =
    view.lines.find((l) => l.oracleId === cutOracleId && l.board === "main")?.quantity ?? 0;
  if (cutMainQty <= 0) return { ok: false, message: "That card isn't in the main deck any more." };
  const cutMaybeQty =
    view.lines.find((l) => l.oracleId === cutOracleId && l.board === "maybe")?.quantity ?? 0;
  const addMainQty =
    view.lines.find((l) => l.oracleId === addOracleId && l.board === "main")?.quantity ?? 0;

  const result = await getContainer().decks.applyChanges(actor, {
    deckId: DeckId.of(deckId),
    fingerprint: fingerprint(view.lines),
    changes: [
      { oracleId: cutOracleId, board: "main", quantity: cutMainQty - 1 },
      { oracleId: cutOracleId, board: "maybe", quantity: Math.min(99, cutMaybeQty + 1) },
      { oracleId: addOracleId, board: "main", quantity: Math.min(99, addMainQty + 1) },
    ],
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error.kind === "DeckChanged"
          ? "The deck changed in another tab — please try again."
          : "Couldn't apply that swap.",
    };
  }
  const deck = await loadBuilderDeck(deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

const CardInDeckInput = z.object({ deckId: DeckIdInput, oracleId: z.string().min(1) });

/** Your other decks holding a card, for the selected-card panel (task 42). */
export async function otherDecksAction(
  input: z.input<typeof CardInDeckInput>,
): Promise<OtherDeckUse[]> {
  const actor = await requireActor();
  const parsed = CardInDeckInput.safeParse(input);
  if (!parsed.success) return [];
  return otherDecksHolding(
    getContainer().db,
    actor.userId,
    parsed.data.deckId,
    parsed.data.oracleId,
  );
}

const TakeInput = z.object({
  deckId: DeckIdInput,
  fromDeckId: DeckIdInput,
  oracleId: z.string().min(1),
  count: z.number().int().min(1).max(99),
});

/**
 * Takes copies of a card out of another of your decks, so they're free for this one (task 42):
 * the sideboard first, then the main deck, never a commander. This deck doesn't change.
 */
export async function takeFromDeckAction(
  input: z.input<typeof TakeInput>,
): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = TakeInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const { deckId, fromDeckId, oracleId, count } = parsed.data;
  const { db, decks } = getContainer();
  const from = await deckView(db, actor.userId, fromDeckId);
  if (from === null || fromDeckId === deckId)
    return { ok: false, message: "That deck isn't yours." };

  const counts = from.lines.filter((line) => line.oracleId === oracleId);
  // One edit per board (the sideboard, then the main deck), each through the decks module.
  for (const change of takeCopies(counts, count)) {
    const result = await decks.setEntry(actor, {
      deckId: DeckId.of(fromDeckId),
      oracleId,
      board: change.board,
      quantity: change.quantity,
    });
    if (!result.ok) return { ok: false, message: `Couldn't change ${from.deck.name}.` };
  }
  revalidatePath(`/decks/${fromDeckId}`);
  const deck = await loadBuilderDeck(deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

const PrintingsInput = z.object({ deckId: DeckIdInput, oracleId: z.string().uuid() });

/** Every printing of a card, for the printing picker (design doc 24). */
export async function printingsAction(
  input: z.input<typeof PrintingsInput>,
): Promise<PrintingOption[] | null> {
  const actor = await requireActor();
  const parsed = PrintingsInput.safeParse(input);
  if (!parsed.success) return null;
  return cardPrintings(getContainer().db, actor.userId, parsed.data.deckId, parsed.data.oracleId);
}

const ChoosePrintingInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  /** null: follow my copies again. */
  pinned: z.object({ printingId: z.string().uuid(), finish: FinishSchema }).nullable(),
});

/** Pins a deck line to a printing and finish, or unpins it; returns the fresh deck. */
export async function choosePrintingAction(
  input: z.input<typeof ChoosePrintingInput>,
): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = ChoosePrintingInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const { deckId, oracleId, board, pinned } = parsed.data;
  const result = await getContainer().decks.choosePrinting(actor, {
    deckId: DeckId.of(deckId),
    oracleId,
    board,
    pinned:
      pinned === null
        ? null
        : { printingId: PrintingId.of(pinned.printingId), finish: pinned.finish },
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const deck = await loadBuilderDeck(deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

/** Cards for this deck and for each role it's short of (design doc 20). */
export async function suggestionsAction(deckId: number): Promise<DeckSuggestions | null> {
  const actor = await requireActor();
  const parsed = DeckIdInput.safeParse(deckId);
  if (!parsed.success) return null;
  return deckSuggestions(getContainer().db, actor.userId, parsed.data);
}

/** Whole-deck Simulated Annealing optimizer preview (design doc 55). */
export async function optimizeDeckAction(
  deckId: number,
  pool: OptimizeDeckPool = "owned",
): Promise<OptimizeResult | null> {
  const actor = await requireActor();
  const parsed = DeckIdInput.safeParse(deckId);
  if (!parsed.success) return null;
  const outcome = await optimizeDeckForView(getContainer().db, actor.userId, parsed.data, { pool });
  return outcome?.result ?? null;
}

/** A mana base you could start from (design doc 35). */
export async function manaBaseAction(deckId: number): Promise<ManaBasePlan | null> {
  const actor = await requireActor();
  const parsed = DeckIdInput.safeParse(deckId);
  if (!parsed.success) return null;
  const plan = await getContainer().capabilities.deckManaPlan({
    userId: actor.userId,
    deckId: parsed.data,
  });
  return plan.ok ? plan.value : null;
}

const DraftDeckInput = z.object({
  deckId: DeckIdInput,
  includeStore: z.enum(["fill-gaps", "none"]).optional(),
});

/** A 100-card Commander draft from owned cards first (design doc 37). */
export async function draftDeckAction(
  input: z.input<typeof DraftDeckInput>,
): Promise<DeckDraft | null> {
  const actor = await requireActor();
  const parsed = DraftDeckInput.safeParse(input);
  if (!parsed.success) return null;
  return draftForDeck(getContainer().db, actor.userId, parsed.data.deckId, {
    includeStore: parsed.data.includeStore,
  });
}

const AddLandsInput = z.object({
  deckId: DeckIdInput,
  lands: z
    .array(z.object({ oracleId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100),
});

/** Adds the planned lands to the main deck in one go, and returns the fresh deck. */
export async function addLandsAction(
  input: z.input<typeof AddLandsInput>,
): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = AddLandsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those lands weren't understood." };
  const { deckId, lands } = parsed.data;
  const result = await getContainer().decks.addCards(actor, {
    deckId: DeckId.of(deckId),
    cards: lands,
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const deck = await loadBuilderDeck(deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

const SimilarInput = z.object({ deckId: DeckIdInput, oracleId: z.string().uuid() });

/** Cards like the selected one, for this deck. */
export async function similarAction(
  input: z.input<typeof SimilarInput>,
): Promise<SuggestionList | null> {
  const actor = await requireActor();
  const parsed = SimilarInput.safeParse(input);
  if (!parsed.success) return null;
  return similarCards(getContainer().db, actor.userId, parsed.data.deckId, parsed.data.oracleId);
}

/** The most a budget list may spend: $1,000. */
const BUDGET_MAXIMUM_CENTS = 100_000;
const BudgetInput = z.object({
  deckId: DeckIdInput,
  budgetCents: z.number().int().min(1).max(BUDGET_MAXIMUM_CENTS),
});

/** Store cards for this deck within a budget. */
export async function budgetAction(input: z.input<typeof BudgetInput>): Promise<BudgetList | null> {
  const actor = await requireActor();
  const parsed = BudgetInput.safeParse(input);
  if (!parsed.success) return null;
  return budgetList(getContainer().db, actor.userId, parsed.data.deckId, parsed.data.budgetCents);
}

const TargetBracketInput = z.object({
  deckId: DeckIdInput,
  target: z.number().int().nullable(),
});

export type TargetBracketResult = Readonly<{ ok: true } | { ok: false; message: string }>;

/** Saves the Commander bracket the owner is aiming for, or clears it (design doc 31). */
export async function setTargetBracketAction(
  input: z.input<typeof TargetBracketInput>,
): Promise<TargetBracketResult> {
  const actor = await requireActor();
  const parsed = TargetBracketInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That bracket wasn't understood." };
  const result = await getContainer().decks.updateDeck(actor, {
    deckId: DeckId.of(parsed.data.deckId),
    targetBracket: parsed.data.target,
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  // The shared view shows the target too.
  revalidatePath(`/decks/${parsed.data.deckId}`);
  return { ok: true };
}

const HeadingName = z.string().max(200);
// One action for every heading change (design doc 34); `kind` says which.
const HeadingInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set"),
    deckId: DeckIdInput,
    oracleId: z.string().min(1),
    board: z.enum(BOARDS),
    heading: HeadingName.nullable(),
  }),
  z.object({
    kind: z.literal("rename"),
    deckId: DeckIdInput,
    from: HeadingName,
    to: HeadingName.nullable(),
  }),
  z.object({ kind: z.literal("order"), deckId: DeckIdInput, order: z.array(HeadingName).max(100) }),
  z.object({ kind: z.literal("grouping"), deckId: DeckIdInput, grouping: z.enum(GROUPINGS) }),
]);

/** Sets a card's heading, renames or orders headings, or switches the grouping (design doc 34). */
export async function headingAction(input: z.input<typeof HeadingInput>): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = HeadingInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const { decks } = getContainer();
  const change = parsed.data;
  const deckId = DeckId.of(change.deckId);
  const result =
    change.kind === "set"
      ? await decks.setEntryHeading(actor, { ...change, deckId })
      : change.kind === "rename"
        ? await decks.renameHeading(actor, { ...change, deckId })
        : change.kind === "order"
          ? await decks.orderHeadings(actor, { deckId, order: change.order })
          : await decks.updateDeck(actor, { deckId, grouping: change.grouping });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const deck = await loadBuilderDeck(change.deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

const NoteInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  note: z.string().max(500).nullable(),
});

/** Sets or clears a line's note (design doc 41). */
export async function noteAction(input: z.input<typeof NoteInput>): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = NoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const result = await getContainer().decks.setEntryNote(actor, {
    deckId: DeckId.of(parsed.data.deckId),
    oracleId: parsed.data.oracleId,
    board: parsed.data.board,
    note: parsed.data.note,
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  revalidatePath(`/decks/${parsed.data.deckId}`);
  const deck = await loadBuilderDeck(parsed.data.deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

export type SnapshotsListResult =
  { ok: true; snapshots: SnapshotSummary[] } | { ok: false; message: string };

/** Lists saved snapshots for a deck, newest first (design doc 41). */
export async function listSnapshotsAction(deckId: number): Promise<SnapshotsListResult> {
  const actor = await requireActor();
  const parsedId = DeckIdInput.safeParse(deckId);
  if (!parsedId.success) return { ok: false, message: "That deck wasn't recognized." };
  const snapshots = await listDeckSnapshots(getContainer().db, actor.userId, parsedId.data);
  if (snapshots === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, snapshots };
}

const SaveSnapshotInput = z.object({
  deckId: DeckIdInput,
  label: z.string().max(120),
});

export type SaveSnapshotResult =
  { ok: true; snapshotId: number; snapshots: SnapshotSummary[] } | { ok: false; message: string };

/** Saves a snapshot of the deck's current entries (design doc 41). */
export async function saveSnapshotAction(
  input: z.input<typeof SaveSnapshotInput>,
): Promise<SaveSnapshotResult> {
  const actor = await requireActor();
  const parsed = SaveSnapshotInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That snapshot label wasn't understood." };
  const { db, decks } = getContainer();
  const result = await decks.saveSnapshot(actor, {
    deckId: DeckId.of(parsed.data.deckId),
    label: parsed.data.label,
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const snapshots = await listDeckSnapshots(db, actor.userId, parsed.data.deckId);
  return {
    ok: true,
    snapshotId: result.value,
    snapshots: snapshots ?? [],
  };
}

const CompareSnapshotInput = z.object({
  deckId: DeckIdInput,
  beforeSnapshotId: z.number().int().positive(),
  afterSnapshotId: z.number().int().positive().nullable().optional(),
});

export type CompareSnapshotResult =
  { ok: true; comparison: SnapshotComparison } | { ok: false; message: string };

/** Compares a saved snapshot against the live deck or another snapshot (design doc 41). */
export async function compareSnapshotAction(
  input: z.input<typeof CompareSnapshotInput>,
): Promise<CompareSnapshotResult> {
  const actor = await requireActor();
  const parsed = CompareSnapshotInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Couldn't compare those snapshots." };
  const comparison = await compareDeckSnapshot(
    getContainer().db,
    actor.userId,
    parsed.data.deckId,
    parsed.data.beforeSnapshotId,
    parsed.data.afterSnapshotId ?? undefined,
  );
  if (comparison === null) return { ok: false, message: "That snapshot isn't available anymore." };
  return { ok: true, comparison };
}

const SnapshotMutationInput = z.object({
  deckId: DeckIdInput,
  snapshotId: z.number().int().positive(),
});

export type RestoreSnapshotResult =
  { ok: true; deck: BuilderDeck; cardCount: number } | { ok: false; message: string };

/** Restores a deck's entries to a saved snapshot (design doc 41). */
export async function restoreSnapshotAction(
  input: z.input<typeof SnapshotMutationInput>,
): Promise<RestoreSnapshotResult> {
  const actor = await requireActor();
  const parsed = SnapshotMutationInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That snapshot wasn't understood." };
  const result = await getContainer().decks.restoreSnapshot(actor, {
    deckId: DeckId.of(parsed.data.deckId),
    snapshotId: SnapshotId.of(parsed.data.snapshotId),
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  revalidatePath(`/decks/${parsed.data.deckId}`);
  const deck = await loadBuilderDeck(parsed.data.deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return {
    ok: true,
    deck,
    cardCount: result.value.cards,
  };
}

/** Deletes a saved snapshot without changing the deck (design doc 41). */
export async function deleteSnapshotAction(
  input: z.input<typeof SnapshotMutationInput>,
): Promise<SnapshotsListResult> {
  const actor = await requireActor();
  const parsed = SnapshotMutationInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That snapshot wasn't understood." };
  const { db, decks } = getContainer();
  const result = await decks.deleteSnapshot(actor, {
    deckId: DeckId.of(parsed.data.deckId),
    snapshotId: SnapshotId.of(parsed.data.snapshotId),
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  const snapshots = await listDeckSnapshots(db, actor.userId, parsed.data.deckId);
  if (snapshots === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, snapshots };
}

/** Tokens, emblems, and helper cards created by a deck's counted cards (design doc 42). */
export async function tokensAction(deckId: number): Promise<TokenLine[] | null> {
  const actor = await requireActor();
  const parsed = DeckIdInput.safeParse(deckId);
  if (!parsed.success) return null;
  const overview = await getContainer().capabilities.deckOverview({
    userId: actor.userId,
    deckId: parsed.data,
    parts: { tokens: true },
  });
  return overview.ok ? [...(overview.value.tokens ?? [])] : null;
}

const EntryDetailsInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  role: z.string().max(MAX_ROLE_LENGTH).nullable().optional(),
  pinned: z.boolean().optional(),
});

/** Sets or clears a line's role and pin (design doc 61). */
export async function entryDetailsAction(
  input: z.input<typeof EntryDetailsInput>,
): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = EntryDetailsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const result = await getContainer().decks.setEntryDetails(actor, {
    deckId: DeckId.of(parsed.data.deckId),
    oracleId: parsed.data.oracleId,
    board: parsed.data.board,
    ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
    ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
  });
  if (!result.ok) {
    return { ok: false, message: describeDeckError(result.error) };
  }
  revalidatePath(`/decks/${parsed.data.deckId}`);
  const deck = await loadBuilderDeck(parsed.data.deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}

/** The deck's plan (structured profile) and primer, for the primer panel (design doc 61). */
export type DeckPlanWithPrimer = Readonly<{ profile: DeckPlan; primer: string }>;

/** Loads the deck's plan and primer, or null if it isn't the player's. */
export async function deckPlanAction(deckId: number): Promise<DeckPlanWithPrimer | null> {
  const actor = await requireActor();
  const overview = await getContainer().capabilities.deckOverview({
    userId: actor.userId,
    deckId,
    parts: { profile: true },
  });
  const stored = overview.ok ? overview.value.profile : null;
  if (stored === null || stored === undefined) return null;
  return { profile: stored.profile, primer: stored.primer ?? "" };
}

const NamedCardInput = z.object({
  cardName: z.string().trim().min(1).max(141),
  reason: z.string().trim().max(200),
});

const DeckPlanInput = z.object({
  deckId: DeckIdInput,
  plan: z.string().trim().max(600).nullable(),
  winCons: z.array(z.string().trim().min(1).max(200)).max(20),
  keyCards: z.array(NamedCardInput).max(40),
  avoid: z.array(NamedCardInput).max(40),
  declaredCombos: z.array(z.string().trim().min(1).max(300)).max(20),
  mulligan: z.string().trim().max(1000).nullable(),
  pilotNotes: z.string().trim().max(2000).nullable(),
  primer: z.string().max(20_000),
});

export type DeckPlanResult =
  { ok: true; plan: DeckPlanWithPrimer } | { ok: false; message: string };

/** Saves the deck's plan fields and its primer (design doc 61). */
export async function saveDeckPlanAction(
  input: z.input<typeof DeckPlanInput>,
): Promise<DeckPlanResult> {
  const actor = await requireActor();
  const parsed = DeckPlanInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Something there is too long or empty; check the fields." };
  }
  const { deckPlanEdits } = getContainer().capabilities;
  const { deckId, primer, ...fields } = parsed.data;
  const updated = await deckPlanEdits.setProfile(actor, {
    deckId,
    patch: {
      ...fields,
      plan: fields.plan === "" ? null : fields.plan,
      mulligan: fields.mulligan === "" ? null : fields.mulligan,
      pilotNotes: fields.pilotNotes === "" ? null : fields.pilotNotes,
    },
  });
  if (!updated.ok) return { ok: false, message: "That deck isn't yours." };
  const savedPrimer = await deckPlanEdits.setPrimer(actor, { deckId, content: primer });
  revalidatePath(`/decks/${deckId}`);
  return {
    ok: true,
    plan: {
      profile: updated.value.profile,
      primer: savedPrimer.ok ? savedPrimer.value.primer : primer.trim(),
    },
  };
}
