"use server";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { BOARDS, DeckId, GROUPINGS, MAX_ROLE_LENGTH } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { afterChange, DeckIdInput } from "../action-helpers";
import { revalidateDeck } from "@/app/decks/paths";

// The deck list's server side (design doc 14): card changes, headings, notes and roles. Each
// returns the fresh deck, or why the change was refused.

const QuantityInput = z.object({
  deckId: z.number().int().positive(),
  oracleId: z.string().min(1),
  printingId: z.string().min(1).optional(),
  board: z.enum(BOARDS),
  quantity: z.number().int().min(0).max(99),
});

/** Sets how many of a card are on one board (0 removes it), and returns the fresh deck. */
export const setQuantityAction = action(QuantityInput, async (context, input) =>
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
export const moveLineAction = action(MoveInput, async (context, input) =>
  afterChange(
    context,
    input.deckId,
    await context.capabilities.deckEdits.moveEntry(context.actor, {
      ...input,
      deckId: DeckId.of(input.deckId),
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

/** What `headingAction` takes, for the browser to build. */
export type HeadingChange = z.input<typeof HeadingInput>;

/** Sets a card's heading, renames or orders headings, or switches the grouping (design doc 34). */
export const headingAction = action(HeadingInput, async (context, change) => {
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
});

const NoteInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  note: z.string().max(500).nullable(),
});

/** Sets or clears a line's note (design doc 41). */
export const noteAction = action(NoteInput, async (context, input) => {
  const result = await context.capabilities.deckEdits.setEntryNote(context.actor, {
    ...input,
    deckId: DeckId.of(input.deckId),
  });
  if (result.ok) revalidateDeck(input.deckId);
  return afterChange(context, input.deckId, result);
});

const EntryDetailsInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  role: z.string().max(MAX_ROLE_LENGTH).nullable().optional(),
  pinned: z.boolean().optional(),
});

/** Sets or clears a line's role and pin (design doc 61). */
export const entryDetailsAction = action(EntryDetailsInput, async (context, input) => {
  const result = await context.capabilities.deckEdits.setEntryDetails(context.actor, {
    deckId: DeckId.of(input.deckId),
    oracleId: input.oracleId,
    board: input.board,
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
  });
  if (result.ok) revalidateDeck(input.deckId);
  return afterChange(context, input.deckId, result);
});
