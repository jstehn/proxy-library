"use server";
import { z } from "zod";
import { PrintingId, type PrintingCard } from "@/modules/catalog";
import {
  BOARDS,
  DeckId,
  type OtherDeckUse,
  type PrintingOption,
  type SuggestionList,
} from "@/modules/decks";
import { action } from "@/server/action-instance";
import { err, ok } from "@/shared/kernel";
import { FinishSchema } from "@/shared/mtg";
import { afterChange, DeckIdInput, loadDeck, NOT_YOURS } from "../action-helpers";
import { rejected } from "../answer";
import { revalidateDeck } from "@/app/decks/paths";

// The selected card's server side (design docs 24 and 42): its details, other decks, printings
// and look-alikes, and the changes made from its sheet.

/** A card's details for the selected-card panel and previews. */
export const cardDetailAction = action(
  z.string().regex(/^[0-9a-f-]{36}$/),
  async ({ capabilities }, printingId): Promise<PrintingCard | null> =>
    (await capabilities.printingDetails([printingId])).get(printingId) ?? null,
);

const CardInDeckInput = z.object({ deckId: DeckIdInput, oracleId: z.string().min(1) });

/** Your other decks holding a card, for the selected-card panel (task 42). */
export const otherDecksAction = action(
  CardInDeckInput,
  async ({ actor, reads }, input): Promise<OtherDeckUse[]> =>
    reads.decks.otherDecksHolding(actor, input.deckId, input.oracleId),
);

const PrintingsInput = z.object({ deckId: DeckIdInput, oracleId: z.string().uuid() });

/** Every printing of a card, for the printing picker (design doc 24). */
export const printingsAction = action(
  PrintingsInput,
  async ({ actor, reads }, input): Promise<PrintingOption[] | null> =>
    reads.decks.printingsOf(actor, input.deckId, input.oracleId),
);

const SimilarInput = z.object({ deckId: DeckIdInput, oracleId: z.string().uuid() });

/** Cards like the selected one, for this deck. */
export const similarAction = action(
  SimilarInput,
  async ({ actor, reads }, input): Promise<SuggestionList | null> =>
    reads.decks.similar(actor, input.deckId, input.oracleId),
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
export const takeFromDeckAction = action(TakeInput, async (context, input) => {
  const result = await context.capabilities.takeFromDeck(context.actor, input);
  if (!result.ok) {
    return err(
      rejected(
        result.error.kind === "CouldNotChangeDeck"
          ? `Couldn't change ${result.error.deckName}.`
          : NOT_YOURS,
      ),
    );
  }
  revalidateDeck(input.fromDeckId);
  const deck = await loadDeck(context, input.deckId);
  return deck === null ? err(rejected(NOT_YOURS)) : ok(deck);
});

const ChoosePrintingInput = z.object({
  deckId: DeckIdInput,
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  /** null: follow my copies again. */
  pinned: z.object({ printingId: z.string().uuid(), finish: FinishSchema }).nullable(),
});

/** Pins a deck line to a printing and finish, or unpins it; returns the fresh deck. */
export const choosePrintingAction = action(ChoosePrintingInput, async (context, input) => {
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
});
