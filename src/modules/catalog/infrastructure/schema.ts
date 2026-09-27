// Tables owned by the catalog module (design doc 04, section 8).
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
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
    imageUris: jsonb("image_uris"), // filled in by the Scryfall pass
    legalities: jsonb("legalities"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("printings_set_number_idx").on(table.setCode, table.collectorNumber),
    index("printings_oracle_idx").on(table.oracleId),
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
  (table) => [primaryKey({ columns: [table.printingId, table.finish, table.day] })],
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
