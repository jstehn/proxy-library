import type { ActivityEvent } from "../domain/events";

/** Where events go: the activity table, in the caller's transaction (patterns.md 16). */
export interface EventRecorder {
  record(event: ActivityEvent, at: Date): Promise<void>;
}

export type ActivityServices = { events: EventRecorder };
