import { sql, type SQL } from "drizzle-orm";
import { latestPriceRows, textArray } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { MOST_SPECIAL_FIRST, ownedCopies } from "./owned";

// The two halves of "cards you could add" (audit S2, decision of 2026-11-19): what you own, one
// row per card, and what the store sells that you don't own, at its cheapest printing. Every
// feature that looks for cards (suggestions, commanders, drafting, the mana base, search for a
// deck) builds its query from these pieces, so they agree on what "owned" and "cheapest" mean.
// This is the only file with that SQL. Cards shared by any number of decks all count: other decks
// never reduce what is available.

/**
 * SQL: a sub-select with one row per oracle card the player counts as theirs (`withReal`: whether
 * real copies count). Columns: `oracle_id`, `owned` (copies of every printing), `owned_real`,
 * `printing_id` and `finish` (the **most special** copy, the default to show and price: design doc
 * 24 rule 6), and `copies_printing_id` and `copies_finish` (the copy held in the greatest number).
 * `oracleIds` limits it to those cards.
 */
export function ownedPerCard(
  userId: UserId,
  withReal: boolean,
  oracleIds?: readonly string[],
): SQL {
  const only =
    oracleIds === undefined ? sql`` : sql`where p.oracle_id = any(${textArray(oracleIds)})`;
  return sql`(select p.oracle_id, sum(c.quantity)::int as owned,
                     coalesce(sum(c.quantity) filter (where c.is_real), 0)::int as owned_real,
                     (array_agg(c.printing_id order by ${MOST_SPECIAL_FIRST}))[1] as printing_id,
                     (array_agg(c.finish order by ${MOST_SPECIAL_FIRST}))[1] as finish,
                     (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1]
                       as copies_printing_id,
                     (array_agg(c.finish order by c.quantity desc, c.printing_id))[1]
                       as copies_finish
                from ${ownedCopies(userId, sql`${withReal}`)} c
                join printings p on p.id = c.printing_id
                ${only}
               group by p.oracle_id)`;
}

/** SQL condition on a printing `p`: the player owns no printing of that card. */
export function notOwned(userId: UserId, withReal: boolean): SQL {
  return sql`not exists (select 1 from ${ownedCopies(userId, sql`${withReal}`)} c
                           join printings op on op.id = c.printing_id
                          where op.oracle_id = p.oracle_id)`;
}

/**
 * SQL: a sub-select of the one printing the store sells cheapest for the card `oracleId` (a SQL
 * expression, e.g. a column), for `join lateral ... on true`. Columns: `printing_id`, `finish`,
 * `usd_cents`. Only printings in an enabled set with a price count; ties go to the lowest id.
 */
export function cheapestForSale(oracleId: SQL): SQL {
  return sql`(select p.id as printing_id, latest.finish, latest.usd_cents
                from printings p
                join card_sets s on s.code = p.set_code and s.is_enabled
                join lateral ${latestPriceRows("p.id")} latest on true
               where p.oracle_id = ${oracleId}
               order by latest.usd_cents, p.id
               limit 1)`;
}

/**
 * SQL: a sub-select (`oracle_id`, `printing_id`, `finish`, `usd_cents`) of the listed cards (or, with `null`, every card matching `filter`) that
 * the player doesn't own and the store sells, each at its cheapest printing. `filter` is a SQL
 * condition on a printing `p` (what must fit the deck); `maxPriceCents` drops dearer cards.
 */
export function cheapestOfCards(
  userId: UserId,
  withReal: boolean,
  oracleIds: readonly string[] | null,
  filter: SQL,
  maxPriceCents?: number,
): SQL {
  const cheaper = maxPriceCents === undefined ? sql`true` : sql`best.usd_cents <= ${maxPriceCents}`;
  return sql`(select wanted.oracle_id, best.printing_id, best.finish, best.usd_cents
                from (select distinct p.oracle_id from printings p
                       where ${oracleIds === null ? sql`true` : sql`p.oracle_id = any(${textArray(oracleIds)})`}
                         and ${filter} and ${notOwned(userId, withReal)}) wanted
                join lateral ${cheapestForSale(sql`wanted.oracle_id`)} best on true
               where ${cheaper})`;
}
