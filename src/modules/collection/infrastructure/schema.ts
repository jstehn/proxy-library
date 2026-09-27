// Tables owned by the collection module (design doc 06, section 8).
import { sql } from "drizzle-orm";
import {
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

/** How many copies of each printing and finish a player owns. Rows at zero are deleted. */
export const collectionCards = pgTable(
  "collection_cards",
  {
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.printingId, table.finish] }),
    check("collection_cards_quantity_positive", sql`${table.quantity} > 0`),
    check("collection_cards_finish_known", sql`${table.finish} in ('nonfoil', 'foil', 'etched')`),
  ],
);

/** Every change to a collection, with where it came from (rule 7). Only ever inserted. */
export const acquisitions = pgTable(
  "acquisitions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(),
    quantity: integer("quantity").notNull(), // negative when cards leave
    source: text("source").notNull(),
    ref: text("ref").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("acquisitions_user_created_idx").on(table.userId, table.createdAt.desc()),
    check("acquisitions_quantity_nonzero", sql`${table.quantity} <> 0`),
    check(
      "acquisitions_source_known",
      sql`${table.source} in ('pack', 'deck', 'product', 'store', 'sale', 'trade')`,
    ),
  ],
);
