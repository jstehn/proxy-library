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
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../../accounts/infrastructure/schema";
import { printings, tokenPrintings } from "../../../catalog/cards/infrastructure/schema";
import type { DeckPlan } from "../domain/deck-profile";
import { timestamptz } from "@/shared/db";

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
    // Structured deck profile (targets, keyCards, avoid, costReducers, winCons, plan, etc.).
    profileJson: jsonb("profile_json").$type<DeckPlan | null>(),
    // Free-form Markdown primer supporting [[Card Name]] links.
    primer: text("primer"),
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
    // Structured role/synergy tags on this line (e.g. ["Blitz", "Sac", "Draw"]).
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // One-line job description shown on hover in the UI.
    role: text("role"),
    // Pinned cards are never suggested for cuts or replacements.
    pinned: boolean("pinned").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.deckId, table.oracleId, table.board] }),
    check(
      "deck_entries_role_length",
      sql`${table.role} is null or char_length(${table.role}) between 1 and 160`,
    ),
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

/** Research sources saved with a deck so later sessions see what was already read. */
export const deckSources = pgTable(
  "deck_sources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    usedFor: text("used_for").notNull(),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [index("deck_sources_deck_idx").on(table.deckId)],
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

/** Reusable named card packages (Phase 59). */
export const cardPackages = pgTable(
  "card_packages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => players.userId),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("card_packages_owner_idx").on(table.ownerId),
    check("card_packages_name_length", sql`char_length(${table.name}) between 1 and 60`),
  ],
);

export const cardPackageEntries = pgTable(
  "card_package_entries",
  {
    packageId: bigint("package_id", { mode: "number" })
      .notNull()
      .references(() => cardPackages.id, { onDelete: "cascade" }),
    oracleId: text("oracle_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    heading: text("heading"),
    note: text("note"),
  },
  (table) => [
    primaryKey({ columns: [table.packageId, table.oracleId] }),
    check("card_package_entries_quantity_positive", sql`${table.quantity} between 1 and 99`),
  ],
);

/**
 * Orphaned: the interactive goldfish (design doc 60) was removed in P24. Nothing reads or writes
 * this table. Dropping it is the owner's call (docs/refactor/removal-list.md).
 */
export const goldfishSessions = pgTable(
  "goldfish_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId, { onDelete: "cascade" }),
    deckId: bigint("deck_id", { mode: "number" })
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    state: jsonb("state").$type<unknown>().notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [
    index("goldfish_sessions_expires_idx").on(table.expiresAt),
    index("goldfish_sessions_user_idx").on(table.userId, table.updatedAt),
  ],
);
