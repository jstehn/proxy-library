"use server";
import { z } from "zod";
import type { OptimizeResult } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { err } from "@/shared/kernel";
import { afterChange, DeckIdInput, NOT_YOURS, refusal } from "../action-helpers";
import { rejected } from "../answer";

// The possible-cuts panel's server side: the optimizer (design doc 55) and swapping a cut for
// a replacement.

const OptimizeInput = z.object({
  deckId: DeckIdInput,
  pool: z.enum(["owned", "store", "both"]),
});

/** Whole-deck Simulated Annealing optimizer preview (design doc 55). */
export const optimizeDeckAction = action(
  OptimizeInput,
  async ({ actor, capabilities }, input): Promise<OptimizeResult | null> =>
    capabilities.deckReads.optimize(actor.userId, input.deckId, input.pool),
);

const SwapInput = z.object({
  deckId: DeckIdInput,
  cutOracleId: z.string().min(1),
  addOracleId: z.string().min(1),
});

/** Atomically moves 1 copy of a cut card to the maybeboard and adds 1 copy of its replacement to main. */
export const swapCardsAction = action(SwapInput, async (context, input) => {
  const result = await context.capabilities.swapCards(context.actor, input);
  if (!result.ok) {
    switch (result.error.kind) {
      case "DeckNotFound":
        return err(rejected(NOT_YOURS));
      case "CardNotInMainDeck":
        return refusal(context, input.deckId, "That card isn't in the main deck any more.");
      case "DeckChanged":
        return refusal(
          context,
          input.deckId,
          "The deck changed in another tab — please try again.",
        );
      default:
        return refusal(context, input.deckId, "Couldn't apply that swap.");
    }
  }
  return afterChange(context, input.deckId, result);
});
