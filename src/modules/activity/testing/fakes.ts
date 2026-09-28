import type { EventRecorder } from "../application/ports";
import type { ActivityEvent } from "../domain/events";

/** Events kept in memory; `recorded` is for test assertions. */
export function inMemoryEventRecorder() {
  const recorded: Array<{ event: ActivityEvent; at: Date }> = [];
  const recorder: EventRecorder = {
    async record(event, at) {
      recorded.push({ event, at });
    },
    async forgetPullsAndPurchases(actorId) {
      const before = recorded.length;
      const kept = recorded.filter(
        ({ event }) => event.actorId !== actorId || event.kind === "trade",
      );
      recorded.splice(0, recorded.length, ...kept);
      return before - kept.length;
    },
  };
  return { ...recorder, recorded };
}
