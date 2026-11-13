// Tables owned by the wishlist module (design doc 26, section 8).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { printings } from "../../catalog/infrastructure/schema";

const cents = (name: string) => bigint(name, { mode: "number" });

/**
 * One card a player wants. `printing_id` is null for "any printing" (whose finish is a
 * preference: nonfoil, foil or cheapest) and set for one exact printing in one finish.
 */
export const wishes = pgTable(
  "wishes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    // Kept for exact wishes too, so "copies of this card" is one lookup for either kind.
    oracleId: text("oracle_id").notNull(),
    printingId: text("printing_id").references(() => printings.id),
    finish: text("finish").notNull(),
    quantity: smallint("quantity").notNull(),
    targetCents: cents("target_cents"),
    savedCents: cents("saved_cents"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("wishes_quantity", sql`${table.quantity} between 1 and 99`),
    check("wishes_target", sql`${table.targetCents} between 1 and 10000000`),
    check("wishes_note", sql`length(${table.note}) <= 200`),
    check(
      "wishes_finish",
      sql`(${table.printingId} is null and ${table.finish} in ('nonfoil', 'foil', 'cheapest'))
        or (${table.printingId} is not null and ${table.finish} in ('nonfoil', 'foil', 'etched'))`,
    ),
    // Rule 1: one wish per target, for each kind.
    uniqueIndex("wishes_any_printing_idx")
      .on(table.userId, table.oracleId, table.finish)
      .where(sql`${table.printingId} is null`),
    uniqueIndex("wishes_exact_printing_idx")
      .on(table.userId, table.printingId, table.finish)
      .where(sql`${table.printingId} is not null`),
    index("wishes_user_idx").on(table.userId, table.createdAt),
  ],
);

/** A player's choices about their wishlist. No row means the defaults (not shared). */
export const wishlistSettings = pgTable("wishlist_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => players.userId, { onDelete: "cascade" }),
  isShared: boolean("is_shared").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
