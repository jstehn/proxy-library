import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { storeOfferRows, textArray } from "@/shared/db";
import { Cents, FinishSchema, type UserId } from "@/shared/kernel";
import type { Offer } from "../domain/lines";
import type { OwnedStack } from "../domain/wish";

// What's for sale and what a player owns of some cards (design doc 26, section 9). Read by the
// Wishlist page and by the use cases (through the WishCatalog adapter), so both see the same.

/** Every printing of these cards that the store sells (enabled sets, priced), in every finish. */
export async function offersOf(db: DbExecutor, oracleIds: readonly string[]): Promise<Offer[]> {
  if (oracleIds.length === 0) return [];
  const rows = await storeOfferRows(db, sql`p.oracle_id = any(${textArray(oracleIds)})`);
  return rows.map((row) => ({
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    finish: FinishSchema.parse(row.finish),
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    variantLabel: row.variant_label,
    releaseDate: row.release_date,
    price: Cents.of(Number(row.usd_cents)),
  }));
}

/** The player's game copies of these cards (never real ones: design doc 16, rule 1). */
export async function ownedOf(
  db: DbExecutor,
  userId: UserId,
  oracleIds: readonly string[],
): Promise<OwnedStack[]> {
  if (oracleIds.length === 0) return [];
  const result = await db.execute<{
    oracle_id: string;
    printing_id: string;
    finish: string;
    quantity: number;
  }>(sql`
    select p.oracle_id, c.printing_id, c.finish, c.quantity
      from collection_cards c join printings p on p.id = c.printing_id
     where c.user_id = ${userId} and p.oracle_id = any(${textArray(oracleIds)})
  `);
  return result.rows.map((row) => ({
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    finish: FinishSchema.parse(row.finish),
    quantity: row.quantity,
  }));
}
