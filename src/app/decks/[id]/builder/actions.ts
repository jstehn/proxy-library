"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { BOARDS, DeckId, describeDeckError, GROUPINGS, MAX_ROLE_LENGTH } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { FinishSchema } from "@/shared/kernel";

import {
  builderAction,
  DeckIdInput,
  NOT_UNDERSTOOD,
  NOT_YOURS,
  fail,
  afterChange,
  loadDeck,
  type BuilderDeck,
  type QuantityResult,
} from "./action-helpers";

// The deck builder's server side (design doc 14): card changes. The browser holds the deck in memory for
// instant statistics and problems (design doc 19); every change goes through the decks module's
// capabilities (ADR 0026), and the fresh deck comes back.

/** Loads the deck for the builder. */
export async function loadBuilderDeck(deckId: number): Promise<BuilderDeck | null> {
  return loadDeck(await readPage(), deckId);
}

const QuantityInput = z.object({
  deckId: z.number().int().positive(),
  oracleId: z.string().min(1),
  printingId: z.string().min(1).optional(),
  board: z.enum(BOARDS),
  quantity: z.number().int().min(0).max(99),
});

/** Sets how many of a card are on one board (0 removes it), and returns the fresh deck. */
export const setQuantityAction = builderAction<typeof QuantityInput, QuantityResult>(
  QuantityInput,
  NOT_UNDERSTOOD,
  async (context, input) =>
    afterChange(
      context,
      input.deckId,
      await context.capabilities.deckEdits.setEntry(context.actor, {
        ...input,
        deckId: DeckId.of(input.deckId),
        printingId: input.printingId ? PrintingId.of(input.printingId) : undefined,
      }),
    ),
);

const MoveInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  from: z.enum(BOARDS),
  to: z.enum(BOARDS),
});

/** Moves a card's line to another board, such as the maybeboard and back (design doc 32). */
export const moveLineAction = builderAction<typeof MoveInput, QuantityResult>(
  MoveInput,
  NOT_UNDERSTOOD,
  async (context, input) =>
    afterChange(
      context,
      input.deckId,
      await context.capabilities.deckEdits.moveEntry(context.actor, {
        ...input,
        deckId: DeckId.of(input.deckId),
      }),
    ),
);

const SwapInput = z.object({
  deckId: DeckIdInput,
  cutOracleId: z.string().min(1),
  addOracleId: z.string().min(1),
});

/** Atomically moves 1 copy of a cut card to the maybeboard and adds 1 copy of its replacement to main. */
export const swapCardsAction = builderAction<typeof SwapInput, QuantityResult>(
  SwapInput,
  fail("That swap wasn't understood."),
  async (context, input) => {
    const result = await context.capabilities.swapCards(context.actor, input);
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return fail(NOT_YOURS);
        case "CardNotInMainDeck":
          return fail("That card isn't in the main deck any more.");
        case "DeckChanged":
          return fail("The deck changed in another tab — please try again.");
        default:
          return fail("Couldn't apply that swap.");
      }
    }
    return afterChange(context, input.deckId, result);
  },
);

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
export const takeFromDeckAction = builderAction<typeof TakeInput, QuantityResult>(
  TakeInput,
  NOT_UNDERSTOOD,
  async (context, input) => {
    const result = await context.capabilities.takeFromDeck(context.actor, input);
    if (!result.ok) {
      return fail(
        result.error.kind === "CouldNotChangeDeck"
          ? `Couldn't change ${result.error.deckName}.`
          : NOT_YOURS,
      );
    }
    revalidatePath(`/decks/${input.fromDeckId}`);
    const deck = await loadDeck(context, input.deckId);
    return deck === null ? fail(NOT_YOURS) : { ok: true, deck };
  },
);

const ChoosePrintingInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  /** null: follow my copies again. */
  pinned: z.object({ printingId: z.string().uuid(), finish: FinishSchema }).nullable(),
});

/** Pins a deck line to a printing and finish, or unpins it; returns the fresh deck. */
export const choosePrintingAction = builderAction<typeof ChoosePrintingInput, QuantityResult>(
  ChoosePrintingInput,
  NOT_UNDERSTOOD,
  async (context, input) => {
    const { deckId, oracleId, board, pinned } = input;
    return afterChange(
      context,
      deckId,
      await context.capabilities.deckEdits.choosePrinting(context.actor, {
        deckId: DeckId.of(deckId),
        oracleId,
        board,
        pinned:
          pinned === null
            ? null
            : { printingId: PrintingId.of(pinned.printingId), finish: pinned.finish },
      }),
    );
  },
);

const AddLandsInput = z.object({
  deckId: DeckIdInput,
  lands: z
    .array(z.object({ oracleId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100),
});

/** Adds the planned lands to the main deck in one go, and returns the fresh deck. */
export const addLandsAction = builderAction<typeof AddLandsInput, QuantityResult>(
  AddLandsInput,
  fail("Those lands weren't understood."),
  async (context, input) =>
    afterChange(
      context,
      input.deckId,
      await context.capabilities.deckEdits.addCards(context.actor, {
        deckId: DeckId.of(input.deckId),
        cards: input.lands,
      }),
    ),
);

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
export const headingAction = builderAction<typeof HeadingInput, QuantityResult>(
  HeadingInput,
  NOT_UNDERSTOOD,
  async (context, change) => {
    const { deckEdits } = context.capabilities;
    const { actor } = context;
    const deckId = DeckId.of(change.deckId);
    const result =
      change.kind === "set"
        ? await deckEdits.setEntryHeading(actor, { ...change, deckId })
        : change.kind === "rename"
          ? await deckEdits.renameHeading(actor, { ...change, deckId })
          : change.kind === "order"
            ? await deckEdits.orderHeadings(actor, { deckId, order: change.order })
            : await deckEdits.updateDeck(actor, { deckId, grouping: change.grouping });
    return afterChange(context, change.deckId, result);
  },
);

const NoteInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  note: z.string().max(500).nullable(),
});

/** Sets or clears a line's note (design doc 41). */
export const noteAction = builderAction<typeof NoteInput, QuantityResult>(
  NoteInput,
  NOT_UNDERSTOOD,
  async (context, input) => {
    const result = await context.capabilities.deckEdits.setEntryNote(context.actor, {
      ...input,
      deckId: DeckId.of(input.deckId),
    });
    if (result.ok) revalidatePath(`/decks/${input.deckId}`);
    return afterChange(context, input.deckId, result);
  },
);

const EntryDetailsInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  role: z.string().max(MAX_ROLE_LENGTH).nullable().optional(),
  pinned: z.boolean().optional(),
});

/** Sets or clears a line's role and pin (design doc 61). */
export const entryDetailsAction = builderAction<typeof EntryDetailsInput, QuantityResult>(
  EntryDetailsInput,
  NOT_UNDERSTOOD,
  async (context, input) => {
    const result = await context.capabilities.deckEdits.setEntryDetails(context.actor, {
      deckId: DeckId.of(input.deckId),
      oracleId: input.oracleId,
      board: input.board,
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    });
    if (result.ok) revalidatePath(`/decks/${input.deckId}`);
    return afterChange(context, input.deckId, result);
  },
);

const TargetBracketInput = z.object({
  deckId: DeckIdInput,
  target: z.number().int().nullable(),
});

export type TargetBracketResult = Readonly<{ ok: true } | { ok: false; message: string }>;

/** Saves the Commander bracket the owner is aiming for, or clears it (design doc 31). */
export const setTargetBracketAction = builderAction<typeof TargetBracketInput, TargetBracketResult>(
  TargetBracketInput,
  fail("That bracket wasn't understood."),
  async ({ actor, capabilities }, input) => {
    const result = await capabilities.deckEdits.updateDeck(actor, {
      deckId: DeckId.of(input.deckId),
      targetBracket: input.target,
    });
    if (!result.ok) return fail(describeDeckError(result.error));
    // The shared view shows the target too.
    revalidatePath(`/decks/${input.deckId}`);
    return { ok: true };
  },
);
