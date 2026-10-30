// Tables owned by the decks module (design doc 09, section 7).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
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
    origin: text("origin"), // "draft:12" when a finished draft made it (design doc 17), else null
    // Who can see it (design doc 21): "private" (the owner) or "shared" (every player).
    visibility: text("visibility").notNull().default("private"),
    firstSharedAt: timestamptz("first_shared_at"),
    // "Use my real cards" (design doc 16): real copies count as owned in this deck. New decks
    // turn it on; decks made before the real collection existed keep it off.
    usesRealCards: boolean("uses_real_cards").notNull().default(false),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("decks_owner_idx").on(table.ownerId),
    index("decks_visibility_idx").on(table.visibility),
    check("decks_visibility_known", sql`${table.visibility} in ('private', 'shared')`),
    check(
      "decks_format_known",
      sql`${table.format} in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'limited')`,
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

/** Comments on decks (design doc 21). A deleted comment keeps its row, without its text. */
export const deckComments = pgTable(
  "deck_comments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => players.userId),
    body: text("body").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    deletedAt: timestamptz("deleted_at"),
    deletedBy: text("deleted_by").references(() => players.userId),
  },
  (table) => [
    index("deck_comments_deck_idx").on(table.deckId, table.createdAt),
    // A deleted comment keeps its row, but not its text.
    check(
      "deck_comments_body_length",
      sql`(${table.deletedAt} is not null and ${table.body} = '') or char_length(${table.body}) between 1 and 1000`,
    ),
  ],
);
