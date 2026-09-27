// Tables owned by the inventory module (design doc 06, section 8).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  bigserial,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Every sealed thing a player owns or owned: products, packs and decks. */
export const sealedItems = pgTable(
  "sealed_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => players.userId),
    contentKind: text("content_kind").notNull(), // "product" | "pack" | "deck"
    // No foreign keys into the catalog: an item must survive its product being re-imported.
    productId: text("product_id"),
    setCode: text("set_code"),
    boosterType: text("booster_type"),
    deckName: text("deck_name"),
    name: text("name").notNull(),
    parentId: bigint("parent_id", { mode: "number" }).references((): AnyPgColumn => sealedItems.id),
    status: text("status").notNull(), // "unopened" | "opened"
    origin: text("origin").notNull(), // "purchase" | "unpacked"
    acquiredAt: timestamptz("acquired_at").notNull(),
    openedAt: timestamptz("opened_at"),
  },
  (table) => [
    index("sealed_items_owner_status_idx").on(table.ownerId, table.status),
    index("sealed_items_parent_idx").on(table.parentId),
    check("sealed_items_status_known", sql`${table.status} in ('unopened', 'opened')`),
    check("sealed_items_origin_known", sql`${table.origin} in ('purchase', 'unpacked')`),
    // Exactly the columns each kind needs (design doc 06, section 8).
    check(
      "sealed_items_content_shape",
      sql`(${table.contentKind} = 'product' and ${table.productId} is not null)
       or (${table.contentKind} = 'pack' and ${table.setCode} is not null and ${table.boosterType} is not null)
       or (${table.contentKind} = 'deck' and ${table.setCode} is not null and ${table.deckName} is not null)`,
    ),
    // Opened exactly when it has an opened time (rule 5).
    check(
      "sealed_items_opened_at",
      sql`(${table.status} = 'opened') = (${table.openedAt} is not null)`,
    ),
  ],
);

/** What each opening produced, kept forever (rule 6). */
export const itemOpenings = pgTable("item_openings", {
  itemId: bigint("item_id", { mode: "number" })
    .primaryKey()
    .references(() => sealedItems.id),
  seed: text("seed"), // null for decks, which aren't random
  result: jsonb("result").notNull(), // a StoredOpening
});
