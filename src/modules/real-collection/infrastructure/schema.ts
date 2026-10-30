// Tables owned by the real-collection module (design doc 16, sections 9 and 15).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { printings, sealedProducts } from "../../catalog/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** The cards a player owns for real, as they recorded them. No ledger: only what's there now. */
export const realCards = pgTable(
  "real_cards",
  {
    userId: text("user_id")
      .notNull()
      .references(() => players.userId, { onDelete: "cascade" }),
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(),
    quantity: integer("quantity").notNull(),
    addedAt: timestamptz("added_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.printingId, table.finish] }),
    // "Printings someone owns for real", for the nightly prices (section 7).
    index("real_cards_printing_idx").on(table.printingId),
    check("real_cards_quantity", sql`${table.quantity} between 1 and 9999`),
    check("real_cards_finish_known", sql`${table.finish} in ('nonfoil', 'foil', 'etched')`),
  ],
);

/** A player's choices about their real collection. No row means the defaults (not shared). */
export const realCollectionSettings = pgTable("real_collection_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => players.userId, { onDelete: "cascade" }),
  isShared: boolean("is_shared").notNull().default(false),
  updatedAt: timestamptz("updated_at").notNull(),
});

/** Sealed products a player owns for real (section 15): one row per copy. */
export const realProducts = pgTable(
  "real_products",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => sealedProducts.id),
    // Which option the player got for each "variable" node, in the order they're met.
    choices: jsonb("choices").notNull().default([]),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [index("real_products_user_idx").on(table.userId)],
);
