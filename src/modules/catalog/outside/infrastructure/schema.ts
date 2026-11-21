// Tables of the catalog module's outside-data area (design docs 45, 52 and 53).
import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { pgVector, timestamptz } from "@/shared/db";

/**
 * Cached EDHREC commander page status (design doc 45). Avoids re-fetching missing commanders
 * every night and lets the worker refresh stale ones on a 14-day TTL.
 */
export const edhrecCommanders = pgTable("edhrec_commanders", {
  commanderOracleId: text("commander_oracle_id").primaryKey(),
  slug: text("slug").notNull(),
  status: text("status").notNull(), // "ok" | "not_found"
  totalDecks: integer("total_decks").notNull().default(0),
  fetchedAt: timestamptz("fetched_at").notNull(),
});

/** Community inclusion rate and synergy score per card for a commander (design doc 45). */
export const edhrecCommanderCards = pgTable(
  "edhrec_commander_cards",
  {
    commanderOracleId: text("commander_oracle_id")
      .notNull()
      .references(() => edhrecCommanders.commanderOracleId, { onDelete: "cascade" }),
    cardOracleId: text("card_oracle_id").notNull(),
    inclusionRate: doublePrecision("inclusion_rate").notNull(),
    synergy: doublePrecision("synergy").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.commanderOracleId, table.cardOracleId] }),
    index("edhrec_commander_cards_synergy_idx").on(table.commanderOracleId, table.synergy),
    check(
      "edhrec_inclusion_range",
      sql`${table.inclusionRate} >= 0 and ${table.inclusionRate} <= 1`,
    ),
    check("edhrec_synergy_range", sql`${table.synergy} >= -1 and ${table.synergy} <= 1`),
  ],
);

/**
 * Commander Spellbook two-card combos (design doc 52, ADR 0025).
 * Canonicalized so `oracleIdA <= oracleIdB` and deduplicated per pair.
 */
export const spellbookTwoCardCombos = pgTable(
  "spellbook_two_card_combos",
  {
    id: text("id").primaryKey(),
    oracleIdA: text("oracle_id_a").notNull(),
    oracleIdB: text("oracle_id_b").notNull(),
    cardNameA: text("card_name_a").notNull(),
    cardNameB: text("card_name_b").notNull(),
    produces: jsonb("produces").$type<string[]>().notNull(),
    bracketTag: text("bracket_tag"),
    manaValue: integer("mana_value"),
    forcesBracket: integer("forces_bracket").notNull(),
    syncedAt: timestamptz("synced_at").notNull(),
  },
  (table) => [
    index("spellbook_combos_a_idx").on(table.oracleIdA),
    index("spellbook_combos_b_idx").on(table.oracleIdB),
    check("spellbook_forces_bracket_range", sql`${table.forcesBracket} in (3, 4)`),
  ],
);

/**
 * Frozen card text embeddings per oracle card (design doc 53, #58).
 * Computed by the worker using `Xenova/bge-small-en-v1.5` over cleaned rules text.
 */
export const cardEmbeddings = pgTable(
  "card_embeddings",
  {
    oracleId: text("oracle_id").primaryKey(),
    model: text("model").notNull(),
    textVersion: integer("text_version").notNull(),
    embedding: pgVector(384)("embedding").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("card_embeddings_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
