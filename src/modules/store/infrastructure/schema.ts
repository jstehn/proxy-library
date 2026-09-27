// Tables owned by the store module (design doc 06, section 8; ADR 0013).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { printings, sealedProducts } from "../../catalog/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: "number" });

/** The MSRP for every product of one kind, e.g. "booster_box/play" (ADR 0014). */
export const msrpPrices = pgTable(
  "msrp_prices",
  {
    kind: text("kind").primaryKey(),
    cents: cents("cents").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    updatedBy: text("updated_by"), // null for the seeded defaults
  },
  (table) => [check("msrp_prices_range", sql`${table.cents} between 1 and 1000000`)],
);

/** One product's own MSRP, used instead of its kind's price. */
export const msrpOverrides = pgTable(
  "msrp_overrides",
  {
    productId: text("product_id")
      .primaryKey()
      .references(() => sealedProducts.id),
    cents: cents("cents").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    updatedBy: text("updated_by"),
  },
  (table) => [check("msrp_overrides_range", sql`${table.cents} between 1 and 1000000`)],
);

/** Every sale the store makes or buy it pays for (ADR 0013). Only ever inserted. */
export const storeTransactions = pgTable(
  "store_transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    itemKind: text("item_kind").notNull(), // "sealed" | "single"
    direction: text("direction").notNull(), // "buy" (player buys) | "sell" (player sells)
    productId: text("product_id").references(() => sealedProducts.id),
    printingId: text("printing_id").references(() => printings.id),
    finish: text("finish"),
    quantity: integer("quantity").notNull(),
    unitMarketCents: cents("unit_market_cents").notNull(), // MSRP for sealed, market for singles
    rateBps: integer("rate_bps").notNull(), // 10000 for buys; the buylist rate for sells
    unitPriceCents: cents("unit_price_cents").notNull(),
    totalCents: cents("total_cents").notNull(),
    priceDay: date("price_day"), // which daily snapshot a single's market price came from
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("store_transactions_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("store_transactions_printing_idx").on(table.printingId),
    check("store_transactions_quantity_positive", sql`${table.quantity} > 0`),
    check("store_transactions_direction_known", sql`${table.direction} in ('buy', 'sell')`),
    check(
      "store_transactions_item_shape",
      sql`(${table.itemKind} = 'sealed' and ${table.productId} is not null and ${table.direction} = 'buy')
       or (${table.itemKind} = 'single' and ${table.printingId} is not null and ${table.finish} is not null)`,
    ),
    check(
      "store_transactions_total",
      sql`${table.totalCents} = ${table.unitPriceCents} * ${table.quantity}`,
    ),
    check("store_transactions_rate", sql`${table.rateBps} between 0 and 10000`),
  ],
);
