"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrintingId, printingCards, type PrintingCard } from "@/modules/catalog";
import {
  BOARDS,
  BROWSE_SORTS,
  BROWSE_SOURCES,
  browseCollection,
  budgetList,
  cardPrintings,
  type PrintingOption,
  deckSuggestions,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
  type SuggestionList,
  DeckId,
  deckView,
  GROUPINGS,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  type Grouping,
  type BrowsePage,
  type CardRules,
  type DeckLine,
  otherDecksHolding,
  type OtherDeckUse,
  takeCopies,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

// The deck builder's server side (design doc 14). The browser holds the deck in memory for
// instant statistics and problems (design doc 19); every change goes through the decks module,
// and the fresh deck comes back.

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);

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
}>;

/** Loads the deck for the builder. */
export async function loadBuilderDeck(deckId: number): Promise<BuilderDeck | null> {
  const actor = await requireActor();
  const { db } = getContainer();
  const view = await deckView(db, actor.userId, deckId);
  if (view === null) return null;
  const cards = await printingCards(
    db,
    view.lines.map((line) => line.printingId),
  );
  return {
    lines: view.lines,
    rules: { ...view.rules },
    cards: Object.fromEntries(cards),
    grouping: view.deck.grouping,
    headings: [...view.deck.headings],
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
    const messages: Record<string, string> = {
      DeckNotFound: "That deck isn't yours.",
      CardNotFound: "That card isn't in the catalog.",
      QuantityInvalid: "That's not a quantity the deck allows (0 to 99).",
    };
    return { ok: false, message: messages[result.error.kind] ?? "Couldn't change the deck." };
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
    const messages: Record<typeof result.error.kind, string> = {
      DeckNotFound: "That deck isn't yours.",
      EntryNotFound: "That card isn't on that board any more.",
      CommanderMove: "Commanders stay where they are.",
    };
    return { ok: false, message: messages[result.error.kind] };
  }
  const deck = await loadBuilderDeck(parsed.data.deckId);
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
  pinned: z
    .object({ printingId: z.string().uuid(), finish: z.enum(["nonfoil", "foil", "etched"]) })
    .nullable(),
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
    const messages: Record<(typeof result.error)["kind"], string> = {
      DeckNotFound: "That deck isn't yours.",
      EntryNotFound: "That card isn't in the deck any more.",
      PrintingNotOfCard: "That printing isn't of this card.",
      FinishNotAvailable: "That printing doesn't come in that finish.",
    };
    return { ok: false, message: messages[result.error.kind] };
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
    const messages: Record<string, string> = {
      DeckNotFound: "That deck isn't yours.",
      TargetBracketInvalid: "A target bracket is 1 to 5.",
      TargetBracketNotCommander: "Only Commander decks have a target bracket.",
    };
    return { ok: false, message: messages[result.error.kind] ?? "Couldn't save the bracket." };
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

/** What a heading refusal says, by its kind. */
const HEADING_MESSAGES: Readonly<Record<string, string>> = {
  DeckNotFound: "That deck isn't yours.",
  EntryNotFound: "That card isn't on that board any more.",
  HeadingInvalid: `A heading starts with a letter, has at most ${MAX_HEADING_LENGTH} characters, and isn't a board or card type ("Sideboard", "Creatures").`,
  HeadingNotFound: "That heading isn't in the deck any more.",
  HeadingOrderInvalid: "The headings changed meanwhile: try again.",
  TooManyHeadings: `A deck can have at most ${MAX_HEADINGS} headings.`,
  NameInvalid: "That change wasn't understood.",
  TargetBracketInvalid: "That change wasn't understood.",
  TargetBracketNotCommander: "That change wasn't understood.",
};

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
    return { ok: false, message: HEADING_MESSAGES[result.error.kind] ?? "That didn't work." };
  }
  const deck = await loadBuilderDeck(change.deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}
