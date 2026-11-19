// "Today's price of a printing" is written once, here (refactor P03). The price_snapshots table
// belongs to the catalog module, but queries in every module read it, and a query may import only
// the kernel, db and card-search (ADR 0009), so the SQL fragments live in db. Lint keeps the table's
// name out of every other template string.
//
// Each function returns a fragment to place inside a larger `sql` template. Its arguments are SQL
// text that names a column or expression of the caller's query: `"p.id"` or sql`p.id`. Pass only
// code literals, never user input (a string is inserted as it is).
import { sql, type SQL } from "drizzle-orm";

type SqlText = string | SQL;

const text = (value: SqlText): SQL => (typeof value === "string" ? sql.raw(value) : value);

/**
 * One row per finish, with that finish's newest price: columns `finish` and `usd_cents`.
 * Use it as `join lateral ${latestPriceRows("p.id")} latest on true`.
 */
export function latestPriceRows(printing: SqlText): SQL {
  return sql`(select distinct on (ps.finish) ps.finish, ps.usd_cents
                from price_snapshots ps where ps.printing_id = ${text(printing)}
               order by ps.finish, ps.day desc)`;
}

/** The newest price of a printing in one finish (null when unpriced), as a scalar. */
export function latestPrice(printing: SqlText, finish: SqlText): SQL {
  return sql`(select s.usd_cents from price_snapshots s
               where s.printing_id = ${text(printing)} and s.finish = ${text(finish)}
               order by s.day desc limit 1)`;
}

/** The newest price in the printing's cheapest finish (null when unpriced), as a scalar. */
export function cheapestPrice(printing: SqlText): SQL {
  return sql`(select min(latest.usd_cents) from ${latestPriceRows(printing)} latest)`;
}

/** A JSON object `{ finish: usd_cents }` of the newest price of each finish, as a scalar. */
export function latestPricesByFinish(printing: SqlText): SQL {
  return sql`(select jsonb_object_agg(latest.finish, latest.usd_cents)
                from ${latestPriceRows(printing)} latest)`;
}

/** The price from the printing's newest snapshot day, any finish (cheapest that day), as a scalar. */
export function newestDayPrice(printing: SqlText): SQL {
  return sql`(select ps.usd_cents from price_snapshots ps
               where ps.printing_id = ${text(printing)}
               order by ps.day desc, ps.usd_cents asc limit 1)`;
}

/** The newest price, nonfoil preferred over any other finish (a hint, such as for auto-pick). */
export function nonfoilFirstPrice(printing: SqlText): SQL {
  return sql`(select s.usd_cents from price_snapshots s
               where s.printing_id = ${text(printing)}
               order by (s.finish = 'nonfoil') desc, s.day desc limit 1)`;
}

/** The newest price (`usd_cents`) and its day (`day`) of a printing in a finish: a one-row set. */
export function latestSnapshot(printing: SqlText, finish: SqlText): SQL {
  return sql`(select s.usd_cents, s.day from price_snapshots s
               where s.printing_id = ${text(printing)} and s.finish = ${text(finish)}
               order by s.day desc limit 1)`;
}

/** The newest day any price was recorded, as a scalar (null before the first sync). */
export function newestPriceDay(): SQL {
  return sql`(select max(day) from price_snapshots)`;
}

/** Every price recorded on the newest day: columns `printing_id`, `finish`, `usd_cents`. */
export function newestDayPrices(): SQL {
  return sql`(select printing_id, finish, usd_cents from price_snapshots
               where day = ${newestPriceDay()})`;
}
