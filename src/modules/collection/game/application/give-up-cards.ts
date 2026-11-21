import { ok, type Result, type UserId } from "@/shared/kernel";
import { combineGains, type Acquisition, type CardGain } from "../domain/cards";
import type { NotEnoughCopies } from "../domain/errors";
import type { CollectionServices } from "./ports";

/**
 * Takes cards out of a player's collection, inside the caller's transaction (selling to the
 * store, giving cards in a trade). Refuses, changing nothing, if they don't own enough.
 */
export async function giveUpCards(
  services: CollectionServices,
  userId: UserId,
  losses: readonly CardGain[],
  acquisition: Acquisition,
): Promise<Result<void, NotEnoughCopies>> {
  const combined = combineGains(losses);
  if (combined.some((loss) => loss.quantity < 0)) {
    throw new RangeError("giveUpCards takes positive quantities of the cards leaving");
  }
  if (combined.length === 0) return ok();
  return services.collection.remove(userId, combined, acquisition);
}
