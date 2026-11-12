// Tables owned by the catalog module (design doc 04, section 8).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const cardSets = pgTable("card_sets", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  releaseDate: text("release_date").notNull(),
  type: text("type").notNull(),
  keyruneCode: text("keyrune_code").notNull(),
  parentCode: text("parent_code"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  isSupporting: boolean("is_supporting").notNull().default(false),
  isStandard: boolean("is_standard").notNull().default(false),
  importedVersion: text("imported_version"),
  importedAt: timestamptz("imported_at"),
  // When the set's printings were last imported, by any kind of import: full, supporting or
  // reference (design doc 16). Null means the sync has never read its set file.
  printingsImportedAt: timestamptz("printings_imported_at"),
});

export const printings = pgTable(
  "printings",
  {
    id: text("id").primaryKey(),
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    collectorNumber: text("collector_number").notNull(),
    name: text("name").notNull(),
    oracleId: text("oracle_id").notNull(),
    scryfallId: text("scryfall_id").notNull().unique(),
    rarity: text("rarity").notNull(),
    colors: text("colors").array().notNull(),
    colorIdentity: text("color_identity").array().notNull(),
    manaCost: text("mana_cost"),
    manaValue: doublePrecision("mana_value").notNull(),
    typeLine: text("type_line").notNull(),
    layout: text("layout").notNull(),
    finishes: text("finishes").array().notNull(),
    borderColor: text("border_color").notNull(),
    frameVersion: text("frame_version").notNull(),
    frameEffects: text("frame_effects").array().notNull(),
    promoTypes: text("promo_types").array().notNull(),
    isFullArt: boolean("is_full_art").notNull(),
    variantLabel: text("variant_label").notNull(),
    faces: jsonb("faces").notNull().default([]), // CardFace[]: printed text and stats per face
    artist: text("artist"),
    imageUris: jsonb("image_uris"), // filled in by the Scryfall pass
    legalities: jsonb("legalities"),
    // Colors of mana it can make (Scryfall's produced_mana), for deck statistics.
    producedMana: text("produced_mana")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Keyword abilities (Scryfall's keywords), for `kw:` searches (design doc 15).
    keywords: text("keywords")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Role tags and themes read from the rules text (design docs 19 and 20), stored by the sync's
    // tag pass so suggestions can filter by them; worked out again when the rules' version grows.
    roleTags: text("role_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    themeTags: text("theme_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Land denial and extra turns read from the rules text (design doc 31), stored by the tag
    // pass for `is:landdenial` / `is:extraturn` searches.
    bracketFlags: text("bracket_flags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // On Wizards' Game Changer list (Scryfall's game_changer), rewritten by every Scryfall pass so
    // a change to the list shows the next night without re-tagging (design doc 31).
    isGameChanger: boolean("is_game_changer").notNull().default(false),
    // Scryfall's edhrec_rank (1 = most popular on EDHREC), rewritten by every Scryfall pass (design doc 39).
    edhrecRank: integer("edhrec_rank"),
    featuresVersion: integer("features_version").notNull().default(0),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("printings_set_number_idx").on(table.setCode, table.collectorNumber),
    index("printings_oracle_idx").on(table.oracleId),
    index("printings_role_tags_idx").using("gin", table.roleTags),
    index("printings_theme_tags_idx").using("gin", table.themeTags),
    index("printings_bracket_flags_idx").using("gin", table.bracketFlags),
    index("printings_game_changer_idx")
      .on(table.isGameChanger)
      .where(sql`${table.isGameChanger}`),
    index("printings_features_version_idx").on(table.featuresVersion),
  ],
);

/** Booster recipes, stored whole as JSON (re-checked with Zod when read in Phase 5). */
export const boosterConfigs = pgTable(
  "booster_configs",
  {
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    boosterType: text("booster_type").notNull(),
    variants: jsonb("variants").notNull(),
    sheets: jsonb("sheets").notNull(),
    sourceSetCodes: text("source_set_codes").array().notNull(),
  },
  (table) => [primaryKey({ columns: [table.setCode, table.boosterType] })],
);

export const sealedProducts = pgTable(
  "sealed_products",
  {
    id: text("id").primaryKey(),
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    name: text("name").notNull(),
    category: text("category").notNull(),
    subtype: text("subtype"),
    releaseDate: text("release_date"),
    contents: jsonb("contents").notNull(),
    // False once a product is no longer in its set's latest import (MTGJSON dropped it, or rule 5
    // left it out). The row stays, so items people own still open; it just isn't sold.
    isListed: boolean("is_listed").notNull().default(true),
  },
  (table) => [index("sealed_products_set_idx").on(table.setCode)],
);

export const deckLists = pgTable(
  "deck_lists",
  {
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    name: text("name").notNull(),
    type: text("type").notNull(),
    cards: jsonb("cards").notNull(),
    sourceSetCodes: text("source_set_codes").array().notNull(),
  },
  (table) => [primaryKey({ columns: [table.setCode, table.name] })],
);

/** One market price per printing, finish and day (ADR 0013). Past days are never changed. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(),
    day: date("day").notNull(),
    usdCents: bigint("usd_cents", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.printingId, table.finish, table.day] }),
    // "The newest price day" is asked often, and the table grows every day (ADR 0013).
    index("price_snapshots_day_idx").on(table.day),
  ],
);

/** The sync job queue and its history (design doc 04, section 5). */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // "full" | "prices"
    status: text("status").notNull(), // "queued" | "running" | "succeeded" | "failed"
    requestedBy: text("requested_by"), // a user id, or null for the nightly schedule
    requestedAt: timestamptz("requested_at").notNull(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (table) => [index("sync_runs_status_idx").on(table.status, table.requestedAt)],
);

// --- Wizards Play Network: photos, key art, MSRPs and details (design doc 13) --------------

/** What we know about each set's WPN page. */
export const wpnPages = pgTable(
  "wpn_pages",
  {
    setCode: text("set_code")
      .primaryKey()
      .references(() => cardSets.code),
    /** The slug an admin typed, used instead of the ones made from the set's name. */
    slugOverride: text("slug_override"),
    /** The slug that worked, or null when none did. */
    slug: text("slug"),
    status: text("status").notNull(),
    keyArt: jsonb("key_art"), // WpnImage | null
    error: text("error"),
    checkedAt: timestamptz("checked_at").notNull(),
  },
  (table) => [
    check("wpn_pages_status_known", sql`${table.status} in ('found', 'no_page', 'unreadable')`),
  ],
);

/** The products a set's WPN page offered at its last read. */
export const wpnProducts = pgTable(
  "wpn_products",
  {
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    releaseDate: text("release_date"),
    msrpCents: integer("msrp_cents"),
    description: text("description"), // plain text
    contents: jsonb("contents").notNull(), // ContentsLine[]
    images: jsonb("images").notNull(), // WpnImage[]
  },
  (table) => [
    primaryKey({ columns: [table.setCode, table.name] }),
    check("wpn_products_msrp_range", sql`${table.msrpCents} between 1 and 1000000`),
  ],
);

/** Which WPN product each of our products belongs to (design doc 13, section 3). */
export const productWpnLinks = pgTable(
  "product_wpn_links",
  {
    productId: text("product_id")
      .primaryKey()
      .references(() => sealedProducts.id),
    wpnSetCode: text("wpn_set_code"),
    wpnName: text("wpn_name"), // null: an admin chose "no WPN product"
    match: text("match").notNull(),
    /** "variants" shows the WPN photos; "one" shows photoIndex; "none" keeps generated art. */
    photo: text("photo").notNull(),
    photoIndex: integer("photo_index"),
  },
  (table) => [
    check("product_wpn_links_match_known", sql`${table.match} in ('by_name', 'by_kind', 'admin')`),
    check("product_wpn_links_photo_known", sql`${table.photo} in ('variants', 'one', 'none')`),
    check(
      "product_wpn_links_one_has_index",
      sql`(${table.photo} = 'one') = (${table.photoIndex} is not null)`,
    ),
  ],
);

/** Images downloaded (in every size) to the artwork store. Others aren't shown yet. */
export const artworkFiles = pgTable("artwork_files", {
  imageId: text("image_id").primaryKey(),
  downloadedAt: timestamptz("downloaded_at").notNull(),
});

/**
 * Paper token printings in English (design doc 25), from Scryfall's bulk file: tokens, emblems
 * and helper cards (The Monarch). Not printings: never sold, owned or searched. Updated in place
 * on each sync, so a deck's chosen art keeps pointing at the same row.
 */
export const tokenPrintings = pgTable(
  "token_printings",
  {
    id: text("id").primaryKey(), // Scryfall id
    oracleId: text("oracle_id").notNull(),
    name: text("name").notNull(),
    setCode: text("set_code").notNull(), // Scryfall's code ("tblb"), not a card_sets row
    collectorNumber: text("collector_number").notNull(),
    layout: text("layout").notNull(),
    colors: text("colors").array().notNull(),
    faces: jsonb("faces").notNull(), // CardFace[]
    artist: text("artist"),
    imageUris: jsonb("image_uris"),
    releasedAt: text("released_at").notNull(), // "2024-08-02"; Scryfall leaves some empty
  },
  (table) => [index("token_printings_oracle_idx").on(table.oracleId)],
);

/** "This printing makes that token printing", from Scryfall's `all_parts` (design doc 25). */
export const printingTokens = pgTable(
  "printing_tokens",
  {
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id, { onDelete: "cascade" }),
    tokenId: text("token_id")
      .notNull()
      .references(() => tokenPrintings.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.printingId, table.tokenId] }),
    index("printing_tokens_token_idx").on(table.tokenId),
  ],
);

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
