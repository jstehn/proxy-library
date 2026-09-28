import type { UserId } from "@/shared/kernel";
import type { Acquisition } from "../domain/cards";
import type { CollectionServices } from "./ports";

/**
 * Takes every card out of a player's collection, inside the caller's transaction (an admin
 * resetting a player). Each stack leaves with a negative acquisition, so the history still adds
 * up. Returns how many copies left.
 */
export async function giveUpEverything(
  services: CollectionServices,
  userId: UserId,
  acquisition: Acquisition,
): Promise<number> {
  const stacks = await services.collection.everything(userId);
  if (stacks.length === 0) return 0;
  const removed = await services.collection.remove(userId, stacks, acquisition);
  // The stacks were just read under a lock, so there are always enough copies.
  if (!removed.ok) throw new Error(`could not remove a locked collection: ${removed.error.kind}`);
  return stacks.reduce((total, stack) => total + stack.quantity, 0);
}
