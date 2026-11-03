import { sql, type SQL } from "drizzle-orm";
import type { UserId } from "@/shared/kernel";

// Which copies count as a player's in a deck (design doc 16, rule 2): every game copy, plus their
// real copies when the deck's "Use my real cards" switch is on. The only place outside the real
// collection that reads its table (rule 1); selling, trading and the store never see it.

/**
 * SQL: a table of the copies `userId` counts as theirs, with the columns user_id, printing_id,
 * finish, quantity and is_real. `withReal` is a boolean SQL expression: whether real copies
 * count (a deck's switch, or `true` to have both and tell them apart by is_real).
 */
export function ownedCopies(userId: UserId, withReal: SQL): SQL {
  return sql`(select user_id, printing_id, finish, quantity, false as is_real
                from collection_cards where user_id = ${userId}
              union all
              select user_id, printing_id, finish, quantity, true as is_real
                from real_cards where user_id = ${userId} and ${withReal})`;
}

/** SQL: whether deck `deckId` counts real copies. */
export function deckUsesRealCards(deckId: number): SQL {
  return sql`coalesce((select d.uses_real_cards from decks d where d.id = ${deckId}), false)`;
}

/**
 * SQL: an ORDER BY list that ranks owned copies, **most special first** (design doc 23,
 * section 14). `c` is a row of `ownedCopies` and `p` its printing. Used everywhere a deck picks
 * which of your copies to show, so a pasted list, the builder's grid and the deck view agree:
 *
 * 1. the latest price of that printing in that finish, highest first (a foil priced as a foil);
 * 2. the finish: etched, then foil, then nonfoil;
 * 3. the frame: borderless, full art, showcase or extended art, a promo, then a plain card;
 * 4. then the copy you hold most of, the newest set, and the printing id (always the same order).
 */
export const MOST_SPECIAL_FIRST = sql`
  (select s.usd_cents from price_snapshots s
    where s.printing_id = c.printing_id and s.finish = c.finish
    order by s.day desc limit 1) desc nulls last,
  case c.finish when 'etched' then 0 when 'foil' then 1 else 2 end,
  case when p.border_color = 'borderless' then 0
       when p.is_full_art then 1
       when p.frame_effects && array['showcase', 'extendedart']::text[] then 2
       when cardinality(p.promo_types) > 0 then 3
       else 4 end,
  c.quantity desc,
  (select cs.release_date from card_sets cs where cs.code = p.set_code) desc nulls last,
  c.printing_id`;
