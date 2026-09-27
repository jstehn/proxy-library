// Tables owned by the activity module (design doc 11, section 2).
import { bigserial, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
// A relative import (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";

export const activityEvents = pgTable(
  "activity_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // "pull" | "purchase" | "trade"
    actorId: text("actor_id")
      .notNull()
      .references(() => players.userId),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(), // the event's other fields
  },
  (table) => [index("activity_events_occurred_idx").on(table.occurredAt.desc())],
);
