import type { DbExecutor } from "@/shared/db";
import type { EventRecorder } from "../application/ports";
import type { ActivityEvent } from "../domain/events";
import { activityEvents } from "./schema";

export function drizzleEventRecorder(db: DbExecutor): EventRecorder {
  async function record(event: ActivityEvent, at: Date): Promise<void> {
    const { kind, actorId, ...payload } = event;
    await db.insert(activityEvents).values({ kind, actorId, occurredAt: at, payload });
  }
  return { record };
}
