import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { TAGS, THEMES, type Tag, type Theme } from "@/shared/card-search";
import type { UserId } from "@/shared/kernel";
import {
  coverageDetails,
  missingCost,
  rankCommanders,
  type CommanderCandidate,
  type CommanderCoverage,
  type CoverageDetails,
  type MissingCost,
  type PoolCard,
  type WithIdentity,
} from "../domain/commanders";
import { canBeCommander } from "../domain/rules";
import { MANA_COLORS, TARGETED_TAGS, type ManaColor } from "../domain/stats";
import { ownedCopies } from "./owned";
import { textArray, tribePattern } from "./suggestions";

// Commanders I can build (design doc 36, section 9): SQL gathers your pool, your lands and the
// cards that could lead a deck; the pure rankCommanders orders them.

export type CommanderSearch = Readonly<{
  /** Only commanders whose identity includes every one of these colors. */
  colors?: readonly ManaColor[];
  /** Legends you don't own too, from the store, with their price. */
  includeStore?: boolean;
  /** Whether your real copies count (design doc 16): off, like a new deck. */
  withReal?: boolean;
}>;

/** One commander in detail, with the cheapest store cards that would close its gaps. */
export type CommanderDetails = CoverageDetails & Readonly<{ missing: MissingCost }>;

/** How many store cards the missing-cost estimate picks from. */
const STORE_LIMIT = 600;

/** SQL: printing `p` is legal in Commander. */
const COMMANDER_LEGAL = sql`coalesce(p.legalities->>'commander', 'legal') in ('legal', 'restricted')`;

/** SQL: printing `p`'s rules text, every face. */
const FACE_TEXT = sql`coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '')`;

/** SQL: printing `p` might lead a deck; `canBeCommander` decides (one definition of it). */
const MAYBE_COMMANDER = sql`(p.type_line ~ '\\mLegendary\\M'
  or exists (select 1 from jsonb_array_elements(p.faces) f where f->>'text' ~* 'can be your commander'))`;

type PoolRow = {
  oracle_id: string;
  name: string;
  type_line: string;
  mana_value: number;
  keywords: string[];
  role_tags: string[];
  theme_tags: string[];
  color_identity: string[];
  rarity: string;
  price_cents: number | null;
};

type CandidateRow = {
  oracle_id: string;
  printing_id: string;
  name: string;
  type_line: string;
  face_text: string;
  has_power_toughness: boolean;
  color_identity: string[];
  keywords: string[];
  is_game_changer: boolean;
  owned: number;
  price_cents: number | null;
  leads: string[] | null;
};

const POOL_COLUMNS = sql`p.oracle_id, p.name, p.type_line, p.mana_value, p.keywords, p.role_tags,
  p.theme_tags, p.color_identity, p.rarity`;

const CANDIDATE_COLUMNS = sql`p.oracle_id, p.id as printing_id, p.name, p.type_line, ${FACE_TEXT} as face_text,
  exists (select 1 from jsonb_array_elements(p.faces) f
           where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
  p.color_identity, p.keywords, p.is_game_changer`;

/** SQL: the latest price of printing `p`, in its cheapest finish. */
const LATEST_PRICE = sql`(select min(latest.usd_cents) from (
    select distinct on (ps.finish) ps.usd_cents from price_snapshots ps
     where ps.printing_id = p.id order by ps.finish, ps.day desc) latest)`;

const colorsOf = (values: readonly string[]): ManaColor[] =>
  values.filter((value): value is ManaColor => (MANA_COLORS as readonly string[]).includes(value));

function toPoolCard(row: PoolRow, pool: "owned" | "store"): PoolCard {
  return {
    oracleId: row.oracle_id,
    name: row.name,
    typeLine: row.type_line,
    manaValue: Number(row.mana_value),
    keywords: row.keywords,
    roles: row.role_tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag)),
    themes: row.theme_tags.filter((theme): theme is Theme =>
      (THEMES as readonly string[]).includes(theme),
    ),
    rarity: row.rarity,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    pool,
    colorIdentity: colorsOf(row.color_identity),
  };
}

function toCandidate(row: CandidateRow): CommanderCandidate {
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    typeLine: row.type_line,
    text: row.face_text,
    colorIdentity: colorsOf(row.color_identity),
    keywords: row.keywords,
    isGameChanger: row.is_game_changer,
    ownedCopies: Number(row.owned),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    leads: row.leads ?? [],
  };
}

const leadsCommander = (row: CandidateRow) =>
  canBeCommander({
    typeLine: row.type_line,
    text: row.face_text,
    hasPowerToughness: row.has_power_toughness,
  });

/** SQL: the copies that count as yours, one row per oracle card with its most-held printing. */
function ownedByOracle(userId: UserId, withReal: boolean): SQL {
  return sql`(select p.oracle_id, sum(c.quantity)::int as owned,
                     (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id
                from ${ownedCopies(userId, sql`${withReal}`)} c join printings p on p.id = c.printing_id
               group by p.oracle_id)`;
}

/**
 * SQL: a table (id, price_cents) of the cards matching `filter` (on a printing `p`) that are for
 * sale in an enabled set and that you own no printing of: each at its cheapest printing, priced
 * once per printing (its latest price, in its cheapest finish).
 */
function cheapestForSale(userId: UserId, withReal: boolean, filter: SQL): SQL {
  return sql`(select distinct on (p.oracle_id) p.id, latest.usd_cents as price_cents
                from printings p join card_sets s on s.code = p.set_code and s.is_enabled
                join lateral (
                  select min(newest.usd_cents) as usd_cents from (
                    select distinct on (ps.finish) ps.usd_cents from price_snapshots ps
                     where ps.printing_id = p.id order by ps.finish, ps.day desc) newest
                ) latest on latest.usd_cents is not null
               where ${filter}
                 and p.oracle_id not in (select owned.oracle_id from ${ownedByOracle(userId, withReal)} owned)
               order by p.oracle_id, latest.usd_cents, p.id)`;
}

/** SQL: the names of your decks led by `oracleId` (a column expression). */
function leadsDecks(userId: UserId, oracleId: SQL): SQL {
  return sql`(select array_agg(distinct d.name order by d.name) from deck_entries e
                join decks d on d.id = e.deck_id
               where d.owner_id = ${userId} and e.board = 'commander' and e.oracle_id = ${oracleId})`;
}

/** Your owned non-land, Commander-legal cards (one per oracle card), and your non-basic lands. */
async function ownedPool(
  db: DbExecutor,
  userId: UserId,
  withReal: boolean,
): Promise<{ pool: PoolCard[]; lands: WithIdentity[] }> {
  const rows = await db.execute<PoolRow & { is_land: boolean; is_basic: boolean }>(sql`
    select ${POOL_COLUMNS}, ${LATEST_PRICE} as price_cents,
           split_part(p.type_line, ' // ', 1) ~ '\\mLand\\M' as is_land,
           p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic
      from ${ownedByOracle(userId, withReal)} owned join printings p on p.id = owned.printing_id
     where ${COMMANDER_LEGAL}
  `);
  const pool: PoolCard[] = [];
  const lands: WithIdentity[] = [];
  for (const row of rows.rows) {
    if (row.is_basic) continue;
    if (row.is_land) lands.push({ colorIdentity: colorsOf(row.color_identity) });
    else pool.push(toPoolCard(row, "owned"));
  }
  return { pool, lands };
}

/** SQL: printing `p`'s identity includes every chosen color. */
function includesColors(colors: readonly ManaColor[] | undefined): SQL {
  return colors === undefined || colors.length === 0
    ? sql`true`
    : // Not textArray: its "_" placeholder would have to be in the identity too.
      sql`p.color_identity @> array[${sql.join(
        colors.map((color) => sql`${color}`),
        sql`, `,
      )}]::text[]`;
}

async function ownedCandidates(
  db: DbExecutor,
  userId: UserId,
  search: CommanderSearch,
): Promise<CommanderCandidate[]> {
  const rows = await db.execute<CandidateRow>(sql`
    select ${CANDIDATE_COLUMNS}, owned.owned, null::int as price_cents,
           ${leadsDecks(userId, sql`owned.oracle_id`)} as leads
      from ${ownedByOracle(userId, search.withReal ?? false)} owned
      join printings p on p.id = owned.printing_id
     where ${MAYBE_COMMANDER} and ${COMMANDER_LEGAL} and ${includesColors(search.colors)}
  `);
  return rows.rows.filter(leadsCommander).map(toCandidate);
}

/** Legends you don't own, each at its cheapest printing for sale in an enabled set. */
async function storeCandidates(
  db: DbExecutor,
  userId: UserId,
  search: CommanderSearch,
): Promise<CommanderCandidate[]> {
  const forSale = cheapestForSale(
    userId,
    search.withReal ?? false,
    sql`${MAYBE_COMMANDER} and ${COMMANDER_LEGAL} and ${includesColors(search.colors)}`,
  );
  const rows = await db.execute<CandidateRow>(sql`
    select ${CANDIDATE_COLUMNS}, 0 as owned, priced.price_cents,
           ${leadsDecks(userId, sql`p.oracle_id`)} as leads
      from ${forSale} priced join printings p on p.id = priced.id
  `);
  return rows.rows.filter(leadsCommander).map(toCandidate);
}

/** Every card that could lead a deck, ranked by how much of it your cards cover (section 9). */
export async function commandersICanBuild(
  db: DbExecutor,
  userId: UserId,
  search: CommanderSearch = {},
): Promise<CommanderCoverage[]> {
  const { pool, lands } = await ownedPool(db, userId, search.withReal ?? false);
  const candidates = [
    ...(await ownedCandidates(db, userId, search)),
    ...(search.includeStore === true ? await storeCandidates(db, userId, search) : []),
  ];
  return rankCommanders(candidates, pool, lands);
}

/** Store cards on-color for this commander that do a targeted role or share its plan. */
async function storeFillers(
  db: DbExecutor,
  userId: UserId,
  details: CoverageDetails,
  withReal: boolean,
): Promise<PoolCard[]> {
  const { commander, plan } = details.coverage;
  const tribes = tribePattern(plan.tribes);
  const tribeMatch =
    tribes === null
      ? sql`false`
      : sql`(split_part(p.type_line, ' // ', 1) ~ ${tribes} or 'Changeling' = any(p.keywords))`;
  const forSale = cheapestForSale(
    userId,
    withReal,
    sql`p.color_identity <@ ${textArray(commander.colorIdentity)} and ${COMMANDER_LEGAL}
        and split_part(p.type_line, ' // ', 1) !~ '\\mLand\\M'
        and p.oracle_id <> ${commander.oracleId}
        and (p.role_tags && ${textArray(TARGETED_TAGS)} or p.theme_tags && ${textArray(plan.themes)}
             or p.keywords && ${textArray(plan.keywords)} or ${tribeMatch})`,
  );
  const rows = await db.execute<PoolRow>(sql`
    select ${POOL_COLUMNS}, priced.price_cents
      from ${forSale} priced join printings p on p.id = priced.id
     order by priced.price_cents, p.name
     limit ${STORE_LIMIT}
  `);
  return rows.rows.map((row) => toPoolCard(row, "store"));
}

/** One card's coverage in detail and what the rest would cost, or null if it can't lead a deck. */
export async function commanderDetails(
  db: DbExecutor,
  userId: UserId,
  oracleId: string,
  withReal = false,
): Promise<CommanderDetails | null> {
  const rows = await db.execute<CandidateRow>(sql`
    select ${CANDIDATE_COLUMNS}, coalesce(owned.owned, 0) as owned,
           case when owned.owned is null then ${LATEST_PRICE} end as price_cents,
           ${leadsDecks(userId, sql`p.oracle_id`)} as leads
      from printings p
      left join ${ownedByOracle(userId, withReal)} owned on owned.oracle_id = p.oracle_id
     where p.oracle_id = ${oracleId} and ${COMMANDER_LEGAL}
     order by owned.owned is null, ${LATEST_PRICE} nulls last, p.id
     limit 1
  `);
  const row = rows.rows[0];
  if (row === undefined || !leadsCommander(row)) return null;
  const candidate = toCandidate(row);
  const { pool, lands } = await ownedPool(db, userId, withReal);
  const details = coverageDetails(candidate, pool, lands);
  const store = await storeFillers(db, userId, details, withReal);
  return { ...details, missing: missingCost(details.coverage, store) };
}
