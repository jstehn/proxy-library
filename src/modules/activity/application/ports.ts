import type { UserId } from "@/shared/kernel";
import type { ActivityEvent } from "../domain/events";

/** Where events go: the activity table, in the caller's transaction (patterns.md 16). */
export interface EventRecorder {
  record(event: ActivityEvent, at: Date): Promise<void>;
  /** Deletes a player's pull and purchase events (not trades: those involve someone else). */
  forgetPullsAndPurchases(actorId: UserId): Promise<number>;
}

export type ActivityServices = { events: EventRecorder };
