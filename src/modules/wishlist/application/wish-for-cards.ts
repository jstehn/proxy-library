import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import { planCardWishes, type CardNeed } from "../domain/card-wishes";
import type { CardNotFound } from "../domain/errors";
import { offersFor } from "../domain/lines";
import { MAX_WISHES, type WishTarget } from "../domain/wish";
import type { WishlistDependencies } from "./ports";

// Wishing for many cards at once: everything your decks, or one deck, are short of (task 71).

/** How many wishes were added and raised, and how many cards were left as they were. */
export type WishedForCards = Readonly<{
  added: number;
  raised: number;
  /** Already wished for, with enough copies or with a finish or printing the player chose. */
  unchanged: number;
  /** Didn't fit on the wishlist (rule 2). */
  skipped: number;
}>;

export function makeWishForCards(dependencies: WishlistDependencies) {
  const { unitOfWork, clock } = dependencies;

  /**
   * Wishes for each card in "any printing, cheapest", wanting `quantity` copies in total. A
   * cheapest wish that wants fewer is raised; any other wish for the card is left alone.
   */
  async function wishForCards(
    actor: Actor,
    needs: readonly CardNeed[],
  ): Promise<Result<WishedForCards, CardNotFound>> {
    const oracleIds = [...new Set(needs.map((need) => need.oracleId))];

    return unitOfWork.run<WishedForCards, CardNotFound>(async ({ wishes, wishCatalog }) => {
      const known = await wishCatalog.knownCards(oracleIds);
      if (oracleIds.some((oracleId) => !known.has(oracleId))) {
        return err({ kind: "CardNotFound" });
      }

      await wishes.lock(actor.userId);
      const existing = await wishes.forCards(actor.userId, oracleIds);
      const room = MAX_WISHES - (await wishes.count(actor.userId));
      const plan = planCardWishes(needs, existing, room);

      for (const raised of plan.raise) {
        const wish = existing.find((candidate) => candidate.id === raised.wishId);
        if (wish === undefined) continue; // the plan only raises wishes it was given
        const { targetPrice, note } = wish; // kept: only the copies change
        await wishes.update(wish.id, { quantity: raised.quantity, targetPrice, note });
      }

      // Like adding one wish: the price saved is today's cheapest copy that fits.
      const forSale = await wishCatalog.forSaleOfCards(plan.add.map((need) => need.oracleId));
      const createdAt = clock.now();
      for (const need of plan.add) {
        const target: WishTarget = {
          kind: "anyPrinting",
          oracleId: need.oracleId,
          finish: "cheapest",
        };
        const best = offersFor({ target }, forSale)[0];
        await wishes.insert({
          userId: actor.userId,
          target,
          quantity: need.quantity,
          targetPrice: null,
          note: "",
          savedPrice: best?.price ?? null,
          createdAt,
        });
      }

      const result: WishedForCards = {
        added: plan.add.length,
        raised: plan.raise.length,
        unchanged: plan.unchanged,
        skipped: plan.skipped,
      };
      return ok(result);
    });
  }

  return wishForCards;
}
