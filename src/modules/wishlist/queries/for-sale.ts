import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { Cents, type UserId } from "@/shared/kernel";
import type { Offer } from "../domain/lines";
import type { OwnedStack } from "../domain/wish";

// What's for sale and what a player owns of some cards (design doc 26, section 9). Read by the
// Wishlist page and by the use cases (through the WishCatalog adapter), so both see the same.

const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

/** `array['a', 'b']::text[]` with every value as a parameter. */
export function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/** Every printing of these cards that the store sells (enabled sets, priced), in every finish. */
export async function offersOf(db: DbExecutor, oracleIds: readonly string[]): Promise<Offer[]> {
  if (oracleIds.length === 0) return [];
  const result = await db.execute<{
    printing_id: string;
    oracle_id: string;
    name: string;
    set_code: string;
    set_name: string;
    collector_number: string;
    variant_label: string;
    release_date: string;
    finish: string;
    usd_cents: number;
  }>(sql`
    select p.id as printing_id, p.oracle_id, p.name, p.set_code, s.name as set_name,
           p.collector_number, p.variant_label, s.release_date, latest.finish, latest.usd_cents
      from printings p
      join card_sets s on s.code = p.set_code and s.is_enabled
      -- The newest price of each finish: what buying it would cost (as the store's quote).
      join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                      from price_snapshots ps where ps.printing_id = p.id
                     order by ps.finish, ps.day desc) latest on true
     where p.oracle_id = any(${textArray(oracleIds)})
  `);
  return result.rows.map((row) => ({
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
