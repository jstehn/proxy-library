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

/** SQL: 1 for a Universes Beyond printing (`p`), else 0; for ordering Magic's own art first. */
const IS_UNIVERSES_BEYOND = sql`case when 'universesbeyond' = any(p.promo_types) then 1 else 0 end`;

/**
 * SQL: an ORDER BY list that ranks owned copies, **most special first** (design doc 23,
 * section 14, as amended by design doc 24, rule 6). `c` is a row of `ownedCopies` and `p` its
 * printing. Used everywhere a deck picks which of your copies to show, so a pasted list, the
 * builder's grid and the deck view agree:
 *
 * 1. the latest price of that printing in that finish, highest first (a foil priced as a foil);
 * 2. Universes Within before Universes Beyond;
 * 3. the finish: etched, then foil, then nonfoil;
 * 4. the frame: borderless, full art, showcase or extended art, a promo, then a plain card
 *    (being Universes Beyond doesn't count as a promo here);
 * 5. then the copy you hold most of, the newest set, and the printing id (always the same order).
 */
export const MOST_SPECIAL_FIRST = sql`
  (select s.usd_cents from price_snapshots s
    where s.printing_id = c.printing_id and s.finish = c.finish
    order by s.day desc limit 1) desc nulls last,
  ${IS_UNIVERSES_BEYOND},
  case c.finish when 'etched' then 0 when 'foil' then 1 else 2 end,
  case when p.border_color = 'borderless' then 0
       when p.is_full_art then 1
       when p.frame_effects && array['showcase', 'extendedart']::text[] then 2
       when cardinality(array_remove(p.promo_types, 'universesbeyond')) > 0 then 3
       else 4 end,
  c.quantity desc,
  (select cs.release_date from card_sets cs where cs.code = p.set_code) desc nulls last,
  c.printing_id`;

/**
 * SQL: an ORDER BY list that ranks a card's printings, **standard first** (design doc 24,
 * rule 2): the art a deck shows for a card you don't own. `p` is a printing and `s` its set.
 *
 * 1. released already (an upcoming set's previews only if there's nothing else);
 * 2. Universes Within before Universes Beyond;
 * 3. not Secret Lair;
 * 4. an ordinary card: modern frame, black or white border, not full art, no showcase or
 *    extended art, no promo type;
 * 5. from an expansion, then a core set, then a Commander set, then anything else;
 * 6. the newest set, the lowest collector number (the main card, not its variants after it),
 *    and the printing id.
 */
export const STANDARD_FIRST = sql`
  case when s.release_date > to_char(current_date, 'YYYY-MM-DD') then 1 else 0 end,
  ${IS_UNIVERSES_BEYOND},
  case when s.name ilike 'Secret Lair%' then 1 else 0 end,
  case when p.frame_version in ('2003', '2015')
             and p.border_color in ('black', 'white')
             and not p.is_full_art
             and not (p.frame_effects && array['showcase', 'extendedart']::text[])
             and cardinality(array_remove(p.promo_types, 'universesbeyond')) = 0
       then 0 else 1 end,
  case s.type when 'expansion' then 0 when 'core' then 1 when 'commander' then 2 else 3 end,
  s.release_date desc,
  nullif(regexp_replace(p.collector_number, '\\D.*$', ''), '')::int nulls last,
  p.collector_number,
  p.id`;
