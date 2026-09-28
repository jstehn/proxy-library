import type { UserId } from "@/shared/kernel";
import type { ActivityEvent } from "../domain/events";
import type { ActivityServices } from "./ports";

/**
 * Records an event inside the caller's transaction, so the feed can never show something that
 * was rolled back (design doc 11, section 2). A pull with no cards records nothing.
 */
export async function recordEvent(
  services: ActivityServices,
  event: ActivityEvent,
  at: Date,
): Promise<void> {
  if (event.kind === "pull" && event.cards.length === 0) return;
  await services.events.record(event, at);
}

/**
 * Deletes a player's pulls and purchases from the feed, inside the caller's transaction (an admin
 * resetting a player: the feed shouldn't boast about cards that are gone). Trades stay, because
 * the other player was part of them. Returns how many events went.
 */
export async function forgetPullsAndPurchases(
  services: ActivityServices,
  actorId: UserId,
): Promise<number> {
  return services.events.forgetPullsAndPurchases(actorId);
}
