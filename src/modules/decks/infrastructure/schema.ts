// Tables owned by the decks module (design doc 09, section 7).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { printings, tokenPrintings } from "../../catalog/infrastructure/schema";

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
    // Unguessable token for `/d/[token]` public read-only links (design doc 47).
    publicToken: text("public_token"),
    // "Use my real cards" (design doc 16): real copies count as owned in this deck. New decks
    // turn it on; decks made before the real collection existed keep it off.
    usesRealCards: boolean("uses_real_cards").notNull().default(false),
    // The Commander bracket the owner means it for, 1–5 (design doc 31); null: none chosen.
    targetBracket: smallint("target_bracket"),
    // How the main deck is grouped (design doc 34): "type" (built-in) or "custom" (its headings).
    grouping: text("grouping").notNull().default("type"),
    // The deck's headings in the owner's order; read and written whole with the deck.
    headingOrder: text("heading_order")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("decks_owner_idx").on(table.ownerId),
    index("decks_visibility_idx").on(table.visibility),
    uniqueIndex("decks_public_token_idx").on(table.publicToken),
    check("decks_visibility_known", sql`${table.visibility} in ('private', 'shared')`),
    check("decks_grouping_known", sql`${table.grouping} in ('type', 'custom')`),
    check(
      "decks_target_bracket",
      sql`${table.targetBracket} is null or (${table.targetBracket} between 1 and 5 and ${table.format} = 'commander')`,
    ),
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
    // The deck's own heading for this line ("Ramp"), design doc 34; null: none.
    heading: text("heading"),
    // Why this card is in the deck (design doc 41); null: none.
    note: text("note"),
  },
  (table) => [
    primaryKey({ columns: [table.deckId, table.oracleId, table.board] }),
    check(
      "deck_entries_heading_length",
      sql`${table.heading} is null or char_length(${table.heading}) between 1 and 40`,
    ),
    check(
      "deck_entries_note_length",
      sql`${table.note} is null or char_length(${table.note}) between 1 and 200`,
    ),
    index("deck_entries_oracle_idx").on(table.oracleId),
    check(
      "deck_entries_board_known",
      sql`${table.board} in ('commander', 'main', 'side', 'maybe')`,
    ),
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

/**
 * Per deck, per token: the art to print and whether it prints at all (design doc 25). No row
 * means the default art, printed. A choice for a token the deck no longer makes is kept but
 * ignored, so it's back if the card comes back.
 */
export const deckTokenChoices = pgTable(
  "deck_token_choices",
  {
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    tokenOracleId: text("token_oracle_id").notNull(),
    // null: the default art. A token that leaves the catalog falls back to the default.
    tokenId: text("token_id").references(() => tokenPrintings.id, { onDelete: "set null" }),
    included: boolean("included").notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.deckId, table.tokenOracleId] })],
);

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
