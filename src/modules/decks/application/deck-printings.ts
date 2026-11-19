// Pinning a deck line to one printing and finish (design doc 24). Every use case works only on the actor's own decks (rule 7): someone else's deck is
// reported as not found.

import type { Actor } from "@/modules/accounts";
import type { PrintingId } from "@/modules/catalog";
import { type Finish, type Result, err, ok } from "@/shared/kernel";
import {
  withPrinting,
  type ChoosePrintingError as PrintingRuleError,
  type Board,
  type DeckId,
} from "../domain/deck";
import type { DeckNotFound } from "../domain/errors";
import type { DecksDependencies } from "./ports";

export type ChoosePrintingError = DeckNotFound | PrintingRuleError;

export type ChoosePrintingInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The printing and finish to pin, or null to follow your copies again (design doc 24). */
  pinned: Readonly<{ printingId: PrintingId; finish: Finish }> | null;
}>;

export function makeDeckPrintings(dependencies: DecksDependencies) {
  const { unitOfWork, clock } = dependencies;

  /**
   * Pins one deck line to a printing and finish, or unpins it (design doc 24). The printing must
   * be of the line's card, in a finish it comes in; the quantity doesn't change.
   */
  async function choosePrinting(
    actor: Actor,
    input: ChoosePrintingInput,
  ): Promise<Result<void, ChoosePrintingError>> {
    return unitOfWork.run<void, ChoosePrintingError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const pinned =
        input.pinned === null
          ? null
          : { ...input.pinned, facts: await cards.printingFacts(input.pinned.printingId) };
      const changed = withPrinting(deck, {
        oracleId: input.oracleId,
        board: input.board,
        pinned,
      });
      if (!changed.ok) return changed;
      await decks.save(changed.value, clock.now());
      return ok();
    });
  }

  return {
    choosePrinting,
  };
}
