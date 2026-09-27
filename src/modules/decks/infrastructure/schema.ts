// Tables owned by the decks module (design doc 09, section 7).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { printings } from "../../catalog/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const decks = pgTable(
  "decks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => players.userId),
    name: text("name").notNull(),
    format: text("format").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("decks_owner_idx").on(table.ownerId),
    check(
      "decks_format_known",
      sql`${table.format} in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander')`,
    ),
  ],
);

/** Cards in decks, by oracle card (any printing counts, ADR 0011), with an optional pinned printing. */
export const deckEntries = pgTable(
  "deck_entries",
  {
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    oracleId: text("oracle_id").notNull(),
    board: text("board").notNull(),
    quantity: integer("quantity").notNull(),
    printingId: text("printing_id").references(() => printings.id),
    finish: text("finish"),
  },
  (table) => [
    primaryKey({ columns: [table.deckId, table.oracleId, table.board] }),
    index("deck_entries_oracle_idx").on(table.oracleId),
    check("deck_entries_board_known", sql`${table.board} in ('commander', 'main', 'side')`),
    check("deck_entries_quantity", sql`${table.quantity} between 1 and 99`),
  ],
);
