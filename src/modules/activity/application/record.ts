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
