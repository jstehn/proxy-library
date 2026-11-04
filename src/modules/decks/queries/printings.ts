import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { deckUsesRealCards, MOST_SPECIAL_FIRST, ownedCopies, STANDARD_FIRST } from "./owned";

// Every printing of one card, for the deck builder's printing picker (design doc 24, section 9).

export type PrintingFinish = "nonfoil" | "foil" | "etched";

/** One finish of a printing: its latest price and how many copies you own in it. */
export type PrintingFinishOption = Readonly<{
  finish: PrintingFinish;
  priceCents: number | null;
  owned: number;
}>;

export type PrintingOption = Readonly<{
  printingId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  releaseDate: string;
  /** What makes it look different: "Borderless", "Showcase", "Universes Beyond", …, or empty. */
  labels: string[];
  finishes: PrintingFinishOption[];
  /** Copies you own of this printing, every finish together. */
  owned: number;
}>;

type Row = {
  printing_id: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  release_date: string;
  labels: string[];
  finishes: PrintingFinishOption[];
  owned: number;
};

/**
 * The printings of `oracleId`, the ones you own first (your most special copy first), then the
 * rest standard first. Copies count as in deck `deckId`: game copies, plus real ones if it uses
 * them. Empty when the deck isn't `userId`'s.
 */
export async function cardPrintings(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  oracleId: string,
): Promise<PrintingOption[]> {
  const owned = ownedCopies(userId, deckUsesRealCards(deckId));
  const result = await db.execute<Row>(sql`
    with deck as (select 1 from decks where id = ${deckId} and owner_id = ${userId}),
    -- Your best copy of each printing, ranked like the deck ranks them.
    best as (
      select c.printing_id, row_number() over (order by ${MOST_SPECIAL_FIRST}) as rank
        from ${owned} c join printings p on p.id = c.printing_id
       where p.oracle_id = ${oracleId}
    )
    select p.id as printing_id, p.set_code, s.name as set_name, p.collector_number,
           s.release_date,
           array_remove(array[
             case when 'universesbeyond' = any(p.promo_types) then 'Universes Beyond' end,
             case when s.name ilike 'Secret Lair%' then 'Secret Lair' end,
             case when p.border_color = 'borderless' then 'Borderless' end,
             case when p.is_full_art then 'Full art' end,
             case when 'showcase' = any(p.frame_effects) then 'Showcase' end,
             case when 'extendedart' = any(p.frame_effects) then 'Extended art' end,
             case when p.frame_version in ('1993', '1997') then 'Old frame' end,
             case when cardinality(array_remove(p.promo_types, 'universesbeyond')) > 0 then 'Promo' end
           ], null) as labels,
           (select coalesce(json_agg(json_build_object(
                     'finish', f.finish,
                     'priceCents', (select ps.usd_cents from price_snapshots ps
                                     where ps.printing_id = p.id and ps.finish = f.finish
                                     order by ps.day desc limit 1),
                     'owned', coalesce((select sum(c.quantity) from ${owned} c
                                         where c.printing_id = p.id and c.finish = f.finish), 0)
                   ) order by f.position), '[]'::json)
              from unnest(p.finishes) with ordinality as f(finish, position)) as finishes,
           coalesce((select sum(c.quantity) from ${owned} c where c.printing_id = p.id), 0)::int as owned
      from printings p join card_sets s on s.code = p.set_code
     where p.oracle_id = ${oracleId} and exists (select 1 from deck)
     order by (select min(b.rank) from best b where b.printing_id = p.id) nulls last,
              ${STANDARD_FIRST}
  `);
  return result.rows.map((row) => ({
    printingId: row.printing_id,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    releaseDate: row.release_date,
    labels: row.labels,
    finishes: row.finishes.map((finish) => ({ ...finish, owned: Number(finish.owned) })),
    owned: row.owned,
  }));
}
