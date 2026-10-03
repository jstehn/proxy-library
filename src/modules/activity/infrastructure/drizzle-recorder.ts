import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { EventRecorder } from "../application/ports";
import { LIBRARY_EVENT_KINDS, type ActivityEvent } from "../domain/events";
import { activityEvents } from "./schema";

export function drizzleEventRecorder(db: DbExecutor): EventRecorder {
  async function record(event: ActivityEvent, at: Date): Promise<void> {
    const { kind, actorId, ...payload } = event;
    await db.insert(activityEvents).values({ kind, actorId, occurredAt: at, payload });
  }
  async function forgetLibraryEvents(actorId: UserId): Promise<number> {
    const deleted = await db
      .delete(activityEvents)
      .where(
        and(
          eq(activityEvents.actorId, actorId),
          inArray(activityEvents.kind, [...LIBRARY_EVENT_KINDS]),
        ),
      )
      .returning({ id: activityEvents.id });
    return deleted.length;
  }

  return { record, forgetLibraryEvents };
}
