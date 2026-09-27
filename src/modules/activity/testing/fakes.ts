import type { EventRecorder } from "../application/ports";
import type { ActivityEvent } from "../domain/events";

/** Events kept in memory; `recorded` is for test assertions. */
export function inMemoryEventRecorder() {
  const recorded: Array<{ event: ActivityEvent; at: Date }> = [];
  const recorder: EventRecorder = {
    async record(event, at) {
      recorded.push({ event, at });
    },
  };
  return { ...recorder, recorded };
}
