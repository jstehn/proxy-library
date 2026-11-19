import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { latestPriceRows } from "./prices";

// What the store sells today (design doc 26, section 9; audit S5): every printing in an enabled
// set, once per finish that has a price, at that finish's newest price. The shopping list and the
// wishlist both read it here, so "for sale" and "today's offer" mean the same.

export type OfferRow = Readonly<{
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
}>;

/** The offers on printings `p` that match `filter` (a SQL condition on `p`). */
export async function storeOfferRows(db: DbExecutor, filter: SQL): Promise<OfferRow[]> {
  const result = await db.execute<OfferRow>(sql`
    select p.id as printing_id, p.oracle_id, p.name, p.set_code, s.name as set_name,
           p.collector_number, p.variant_label, s.release_date, latest.finish, latest.usd_cents
      from printings p
      join card_sets s on s.code = p.set_code and s.is_enabled
      join lateral ${latestPriceRows("p.id")} latest on true
     where ${filter}
  `);
  return result.rows;
}
