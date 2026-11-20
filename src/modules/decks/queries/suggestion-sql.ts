import type { SignalIO } from "@/shared/kernel";
import { bracketFlagsOf } from "../domain/brackets";
import type { BracketFlag } from "@/shared/kernel";
import { featureArray, signalIO } from "@/shared/card-search/sql";
import { sql, type SQL } from "drizzle-orm";
import { type DbExecutor, latestPrice, textArray } from "@/shared/db";
import { ColorSchema, FinishSchema, type Tag, type Theme, type UserId } from "@/shared/kernel";

import { cheapestForSale, legalInFormat, notOwned, ownedPerCard } from "./candidate-pool";
import type { SuggestionCard, SuggestionContext, Wanted } from "../domain/suggestion-types";

// The SQL that finds suggestion candidates (design doc 20, section 9): cards you own and cards in
// the store that share something with the deck, on the pool in candidate-pool.ts.

/** How many candidates SQL hands to the scoring, per pool. */
const CANDIDATE_LIMIT = 400;

/** The conditions every suggestion meets (invariant 2), on a printing `p`. */
export function fitsDeck(context: SuggestionContext): SQL {
  const identity =
    context.colorLimit === null
      ? sql`true`
      : sql`p.color_identity <@ ${textArray(context.colorLimit)}`;
  const legal = legalInFormat(context.format);
  return sql`${identity} and ${legal}
    and not (p.oracle_id = any(${textArray(context.inDeck)}))
    and p.type_line !~ '^Basic\\y.*\\yLand\\y'`;
}

/** Creature types are words; anything else is dropped before it reaches a pattern. */
export function tribePattern(tribes: readonly string[]): string | null {
  const safe = tribes.filter((tribe) => /^[A-Za-z][A-Za-z'-]*$/.test(tribe));
  return safe.length === 0 ? null : `\\m(${safe.join("|")})\\M`;
}

/** How many kinds of thing a printing shares with what's wanted: SQL's rough first cut. */
function sharedCount(want: Wanted): SQL {
  const tribes = tribePattern(want.tribes);
  return sql`((${featureArray("role_tags")} && ${textArray(want.roles)})::int
            + (${featureArray("theme_tags")} && ${textArray(want.themes)})::int
            + (p.keywords && ${textArray(want.keywords)})::int
            + ${tribes === null ? sql`0` : sql`(split_part(p.type_line, ' // ', 1) ~ ${tribes} or 'Changeling' = any(p.keywords))::int`})`;
}

export type CandidateRow = {
  oracle_id: string;
  printing_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  rarity: string;
  keywords: string[];
  role_tags: Tag[];
  bracket_flags: BracketFlag[];
  signals: SignalIO;
  theme_tags: Theme[];
  color_identity: string[];
  legality: string | null;
  face_text: string;
  has_power_toughness: boolean;
  is_basic_land: boolean;
  produced_mana: string[] | null;
  is_game_changer: boolean;
  set_code: string;
  collector_number: string;
  finish: string;
  price_cents: number | null;
  owned: number;
  owned_real: number;
  other_decks: number;
  free: number;
  edhrec_rank: number | null;
  edhrec_inclusion: number | null;
  edhrec_synergy: number | null;
  edhrec_total_decks: number | null;
};

function edhrecCte(commanderOracleIds: string[]): SQL {
  if (commanderOracleIds.length === 0) {
    return sql`select null::text as card_oracle_id, 0::real as inclusion_rate, 0::real as synergy, 0::int as total_decks where false`;
  }
  const ids = sql.join(
    commanderOracleIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`select ec.card_oracle_id,
                    max(ec.inclusion_rate)::real as inclusion_rate,
                    max(ec.synergy)::real as synergy,
                    max(e.total_decks)::int as total_decks
               from edhrec_commander_cards ec
               join edhrec_commanders e on e.commander_oracle_id = ec.commander_oracle_id
              where ec.commander_oracle_id in (${ids})
              group by ec.card_oracle_id`;
}

/** The columns a candidate row needs, from a printing `p` (its card) and a finish `finish`. */
export function candidateColumns(context: SuggestionContext): SQL {
  return sql`p.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value, p.type_line,
    p.rarity, p.keywords, ${featureArray("role_tags")} as role_tags, ${featureArray("theme_tags")} as theme_tags,
    ${featureArray("bracket_flags")} as bracket_flags, ${signalIO()} as signals, p.color_identity,
    p.legalities->>${context.format} as legality,
    coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
    exists (select 1 from jsonb_array_elements(p.faces) f
             where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
    p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
    p.produced_mana, p.is_game_changer, p.edhrec_rank, p.set_code, p.collector_number`;
}

function isComboPartnerSql(partnerIds: readonly string[], column: SQL = sql`p.oracle_id`): SQL {
  return partnerIds.length === 0 ? sql`false` : sql`${column} = any(${textArray(partnerIds)})`;
}

function isComboPartnerOrderSql(
  partnerIds: readonly string[],
  column: SQL = sql`p.oracle_id`,
): SQL {
  return partnerIds.length === 0 ? sql`` : sql`(${column} = any(${textArray(partnerIds)})) desc,`;
}

/** Cards you own that share something with what's wanted: one per oracle card. */
export async function ownedCandidates(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  want: Wanted,
  comboPartnerIds: readonly string[] = [],
): Promise<SuggestionCard[]> {
  const rows = await db.execute<CandidateRow>(sql`
    with owned as ${ownedPerCard(userId, context.usesRealCards)},
    edhrec as (
      ${edhrecCte(context.commanderOracleIds)}
    )
    select ${candidateColumns(context)}, owned.finish, owned.owned, owned.owned_real,
           ${latestPrice("p.id", "owned.finish")} as price_cents,
           (select count(distinct e.deck_id) from deck_entries e join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${context.deckId}
               and e.oracle_id = owned.oracle_id and e.board <> 'maybe')::int as other_decks,
           greatest(owned.owned - coalesce((select sum(e.quantity) from deck_entries e
                                              join decks d on d.id = e.deck_id
                                             where d.owner_id = ${userId} and d.id <> ${context.deckId}
                                               and e.oracle_id = owned.oracle_id
                                               and e.board <> 'maybe'), 0), 0)::int as free,
           edhrec.inclusion_rate as edhrec_inclusion,
           edhrec.synergy as edhrec_synergy,
           edhrec.total_decks as edhrec_total_decks
      from owned join printings p on p.id = owned.printing_id
      left join edhrec on edhrec.card_oracle_id = p.oracle_id
     where ${fitsDeck(context)}
       and (${sharedCount(want)} > 0 or edhrec.synergy >= 0.05 or edhrec.inclusion_rate >= 0.15 or ${isComboPartnerSql(comboPartnerIds)})
     order by ${isComboPartnerOrderSql(comboPartnerIds)} ${sharedCount(want)} desc,
              coalesce(edhrec.synergy, 0) desc, coalesce(edhrec.inclusion_rate, 0) desc, p.name
     limit ${CANDIDATE_LIMIT}
  `);
  return rows.rows
    .map((row) => toCard(row, "owned", context))
    .filter((card) => card.owned > card.inThisDeck);
}

/**
 * Cards in the store (an enabled set, with a price) that share something with what's wanted and
 * that you don't own in any printing: each at its cheapest printing and finish (invariant 3).
 */
export async function storeCandidates(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  want: Wanted,
  comboPartnerIds: readonly string[] = [],
): Promise<SuggestionCard[]> {
  const rows = await db.execute<CandidateRow>(sql`
    with edhrec as (
      ${edhrecCte(context.commanderOracleIds)}
    ),
    matching as (
      select distinct on (p.oracle_id) p.oracle_id, ${sharedCount(want)} as shared,
             coalesce(edhrec.synergy, 0) as edhrec_synergy,
             coalesce(edhrec.inclusion_rate, 0) as edhrec_inclusion,
             edhrec.total_decks as edhrec_total_decks,
             case p.rarity when 'mythic' then 3 when 'rare' then 2 when 'uncommon' then 1 else 0 end
               as rarity_rank
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
        left join edhrec on edhrec.card_oracle_id = p.oracle_id
       where ${fitsDeck(context)}
         and (${sharedCount(want)} > 0 or edhrec.synergy >= 0.05 or edhrec.inclusion_rate >= 0.15 or ${isComboPartnerSql(comboPartnerIds)})
         and ${notOwned(userId, context.usesRealCards)}
       order by p.oracle_id, rarity_rank desc
    ),
    kept as (
      select oracle_id, edhrec_inclusion, edhrec_synergy, edhrec_total_decks from matching
       order by ${isComboPartnerOrderSql(comboPartnerIds, sql`oracle_id`)} shared desc,
                edhrec_synergy desc, edhrec_inclusion desc, rarity_rank desc, oracle_id
       limit ${CANDIDATE_LIMIT}
    ),
    cheapest as (
      select kept.oracle_id, best.printing_id, best.finish, best.usd_cents
        from kept
        join lateral ${cheapestForSale(sql`kept.oracle_id`)} best on true
    )
    select ${candidateColumns(context)}, cheapest.finish, cheapest.usd_cents as price_cents,
           0 as owned, 0 as owned_real, 0 as other_decks, 0 as free,
           kept.edhrec_inclusion, kept.edhrec_synergy, kept.edhrec_total_decks
      from cheapest
      join kept on kept.oracle_id = cheapest.oracle_id
      join printings p on p.id = cheapest.printing_id
  `);
  return rows.rows.map((row) => toCard(row, "store", context));
}

export function toCard(
  row: CandidateRow,
  pool: "owned" | "store",
  context: SuggestionContext,
): SuggestionCard {
  const { format } = context;
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value),
    typeLine: row.type_line,
    owned: Number(row.owned),
    ownedReal: Number(row.owned_real),
    inThisDeck: context.countedQuantities.get(row.oracle_id) ?? 0,
    otherDecks: Number(row.other_decks),
    free: Number(row.free),
    misfit: null,
    rules: {
      name: row.name,
      typeLine: row.type_line,
      text: row.face_text,
      colorIdentity: row.color_identity.map((color) => ColorSchema.parse(color)),
      legalities: row.legality === null ? {} : { [format]: row.legality },
      isBasicLand: row.is_basic_land,
      hasPowerToughness: row.has_power_toughness,
    },
    producedMana: row.produced_mana ?? [],
    text: row.face_text,
    isGameChanger: row.is_game_changer,
    bracketFlags: bracketFlagsOf(row.is_game_changer, row.bracket_flags),
    signals: row.signals,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    finish: FinishSchema.parse(row.finish),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    pool,
    keywords: row.keywords,
    roles: row.role_tags,
    themes: row.theme_tags,
    rarity: row.rarity,
    edhrecRank: row.edhrec_rank === null ? null : Number(row.edhrec_rank),
    ...(row.edhrec_inclusion !== null && row.edhrec_synergy !== null
      ? {
          edhrec: {
            inclusionRate: Number(row.edhrec_inclusion),
            synergy: Number(row.edhrec_synergy),
            ...(row.edhrec_total_decks !== null
              ? { totalDecks: Number(row.edhrec_total_decks) }
              : {}),
          },
        }
      : {}),
  };
}

export async function ownedCandidatesForIds(
  db: DbExecutor,
  userId: UserId,
  context: SuggestionContext,
  oracleIds: readonly string[],
  maxPriceCents?: number,
): Promise<SuggestionCard[]> {
  if (oracleIds.length === 0) return [];
  const priceFilter =
    maxPriceCents !== undefined
      ? sql`and ps.usd_cents is not null and ps.usd_cents <= ${maxPriceCents}`
      : sql``;
  const rows = await db.execute<CandidateRow>(sql`
    with owned as ${ownedPerCard(userId, context.usesRealCards, oracleIds)}
    select ${candidateColumns(context)}, owned.finish, owned.owned, owned.owned_real,
           ps.usd_cents as price_cents,
           (select count(distinct e.deck_id) from deck_entries e join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${context.deckId}
               and e.oracle_id = owned.oracle_id and e.board <> 'maybe')::int as other_decks,
           greatest(owned.owned - coalesce((select sum(e.quantity) from deck_entries e
                                              join decks d on d.id = e.deck_id
                                             where d.owner_id = ${userId} and d.id <> ${context.deckId}
                                               and e.oracle_id = owned.oracle_id
                                               and e.board <> 'maybe'), 0), 0)::int as free,
           null as edhrec_inclusion, null as edhrec_synergy, null as edhrec_total_decks
      from owned
      join printings p on p.id = owned.printing_id
      left join lateral (select ${latestPrice("p.id", "owned.finish")} as usd_cents) ps on true
     where ${fitsDeck(context)}
       ${priceFilter}
  `);
  return rows.rows
    .map((row) => toCard(row, "owned", context))
    .filter((card) => card.owned > card.inThisDeck);
}
