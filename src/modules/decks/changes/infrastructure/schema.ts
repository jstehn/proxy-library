// Tables owned by the changes area of the decks module (design doc 40, 41).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../../accounts/infrastructure/schema";
import { decks } from "../../core/infrastructure/schema";
import type { ChangeToSave } from "../application/ports";
import { timestamptz } from "@/shared/db";

/** Point-in-time snapshots of a deck for comparing before/after cuts (design doc 41). */
export const deckSnapshots = pgTable(
  "deck_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    format: text("format").notNull(),
    targetBracket: smallint("target_bracket"),
    grouping: text("grouping").notNull().default("type"),
    headingOrder: text("heading_order")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    entries: jsonb("entries").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("deck_snapshots_deck_idx").on(table.deckId, table.createdAt),
    check("deck_snapshots_label_length", sql`char_length(${table.label}) between 1 and 60`),
    check("deck_snapshots_grouping_known", sql`${table.grouping} in ('type', 'custom')`),
    check(
      "deck_snapshots_target_bracket",
      sql`${table.targetBracket} is null or (${table.targetBracket} between 1 and 5 and ${table.format} = 'commander')`,
    ),
    check(
      "deck_snapshots_format_known",
      sql`${table.format} in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'limited')`,
    ),
  ],
);

/** Dry-run deck changes waiting to be applied, 30 minutes each (design doc 40). */
export const deckChangePreviews = pgTable(
  "deck_change_previews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId, { onDelete: "cascade" }),
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    changes: jsonb("changes").$type<ChangeToSave[]>().notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [index("deck_change_previews_expires_idx").on(table.expiresAt)],
);
