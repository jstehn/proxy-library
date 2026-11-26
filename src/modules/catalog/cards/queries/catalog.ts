import { count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Actor, AdminActor } from "@/modules/accounts";
import type { DbExecutor } from "@/shared/db";
import { parseSearch } from "@/shared/card-search";
import { FOIL_IN_CATALOG, searchCondition } from "@/modules/catalog/cards/queries/search-sql";
import { Cents } from "@/shared/kernel";
import { colorCombination, type ManaColor, type CardFacts } from "@/shared/mtg";
import type { Finish } from "../domain/types";
import { cardSets, printings, syncRuns } from "../infrastructure/schema";
import {
  PRINTING_CARD_COLUMNS,
  toPrintingCard,
  type PrintingCard,
  type PrintingCardRow,
} from "./printing-cards";

// Read models for the catalog screens (ADR 0006): plain objects, ready to render.

export type AdminSetRow = Readonly<{
  code: string;
  name: string;
  releaseDate: string;
  type: string;
  isEnabled: boolean;
  isSupporting: boolean;
  isStandard: boolean;
  printingCount: number;
}>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the AdminActor parameter is the access rule
export async function listSetsForAdmin(db: DbExecutor, admin: AdminActor): Promise<AdminSetRow[]> {
  return db
    .select({
      code: cardSets.code,
      name: cardSets.name,
      releaseDate: cardSets.releaseDate,
      type: cardSets.type,
      isEnabled: cardSets.isEnabled,
      isSupporting: cardSets.isSupporting,
      isStandard: cardSets.isStandard,
      printingCount: count(printings.id),
    })
    .from(cardSets)
    .leftJoin(printings, eq(printings.setCode, cardSets.code))
    .groupBy(cardSets.code)
    .orderBy(desc(cardSets.releaseDate), cardSets.code);
}

export type SetSummary = Readonly<{
  code: string;
  name: string;
  releaseDate: string;
  keyruneCode: string;
  printingCount: number;
}>;

/** Enabled sets that have been imported, newest first. */
export async function enabledSets(db: DbExecutor): Promise<SetSummary[]> {
  const rows = await db
    .select({
      code: cardSets.code,
      name: cardSets.name,
      releaseDate: cardSets.releaseDate,
      keyruneCode: cardSets.keyruneCode,
      printingCount: count(),
    })
    .from(cardSets)
    .innerJoin(printings, eq(printings.setCode, cardSets.code))
    .where(eq(cardSets.isEnabled, true))
    .groupBy(cardSets.code)
    .orderBy(desc(cardSets.releaseDate));
  return rows;
}

export async function findSet(db: DbExecutor, code: string): Promise<SetSummary | null> {
  const [row] = await db
    .select({
      code: cardSets.code,
      name: cardSets.name,
      releaseDate: cardSets.releaseDate,
      keyruneCode: cardSets.keyruneCode,
      printingCount: count(printings.id),
    })
    .from(cardSets)
    .leftJoin(printings, eq(printings.setCode, cardSets.code))
    .where(eq(cardSets.code, code.toUpperCase()))
    .groupBy(cardSets.code);
  return row ?? null;
}

/** A set's printings in collector-number order, each with its latest price per finish. */
export async function setPrintings(db: DbExecutor, code: string): Promise<PrintingCard[]> {
  const rows = await db.execute<PrintingCardRow>(sql`
    select ${PRINTING_CARD_COLUMNS}
      from printings p
     where p.set_code = ${code.toUpperCase()}
     -- "12" before "100", and "A-12" style numbers after plain ones.
     order by nullif(regexp_replace(p.collector_number, '\\D', '', 'g'), '')::int nulls last,
              p.collector_number
  `);
  return rows.rows.map(toPrintingCard);
}

export type SyncRunRow = Readonly<{
  id: number;
  kind: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
}>;

export async function recentSyncRuns(
  db: DbExecutor,
  admin: AdminActor,
  limit = 20,
): Promise<SyncRunRow[]> {
  const rows = await db.select().from(syncRuns).orderBy(desc(syncRuns.requestedAt)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    // Written by this module as a SyncSummary object, so this shape is known.
    summary: row.summary as Record<string, unknown> | null,
    error: row.error,
  }));
}

/** What the singles store can be filtered and sorted by. Empty fields don't filter. */
export type PrintingSearch = Readonly<{
  /** Card search text, Scryfall-style (design doc 15): `bolt`, `t:creature mv<=2`, … */
  search?: string;
  setCode?: string;
  rarity?: string;
  /**
   * "W", "U", "B", "R", "G" (includes that color), "C" (colorless), "M" (multicolored), or a
   * combination's code such as "GU" (exactly those colors).
   */
  color?: string;
  sort: "name" | "number" | "price" | "mana";
  page: number; // from 1
  /** One row per card (its cheapest printing in the store) instead of one per printing. */
  oneRowPerCard?: boolean;
}>;

const SEARCH_PAGE_SIZE = 60;

/** SQL: printing "p" has exactly these colors. */
function hasExactly(colors: readonly ManaColor[]): SQL {
  const array = sql.join(
    colors.map((color) => sql`${color}`),
    sql`, `,
  );
  return sql`(cardinality(p.colors) = ${colors.length} and p.colors @> array[${array}]::text[])`;
}

/** SQL conditions for a search, on printings aliased "p", and notes about ignored parts. */
function printingConditions(
  actor: Actor,
  search: PrintingSearch,
): { where: SQL; notes: readonly string[] } {
  const parsed = parseSearch(search.search ?? "");
  const conditions = [
    searchCondition(parsed.node, { userId: actor.userId, foil: FOIL_IN_CATALOG }),
  ];
  if (search.setCode) conditions.push(sql`p.set_code = ${search.setCode.toUpperCase()}`);
  if (search.rarity) conditions.push(sql`p.rarity = ${search.rarity}`);
  const combination = search.color ? colorCombination(search.color) : undefined;
  if (search.color === "C") conditions.push(sql`cardinality(p.colors) = 0`);
  else if (search.color === "M") conditions.push(sql`cardinality(p.colors) > 1`);
  else if (combination) conditions.push(hasExactly(combination.colors));
  else if (search.color) conditions.push(sql`${search.color} = any(p.colors)`);
  return { where: sql.join(conditions, sql` and `), notes: parsed.notes };
}

export type SearchResult = Readonly<{
  printingIds: string[];
  total: number;
  pageCount: number;
  /** Parts of the search that were ignored, to show under the box. */
  notes: readonly string[];
}>;

/**
 * Printings in enabled sets matching a search, one page at a time (the singles store). Returns
 * ids in order; `printingCards` supplies what to show for them.
 */
export async function searchPrintings(
  db: DbExecutor,
  actor: Actor,
  search: PrintingSearch,
): Promise<SearchResult> {
  const { where, notes } = printingConditions(actor, search);
  const order = {
    name: sql`p.name, p.set_code, p.collector_number`,
    number: sql`p.set_code, nullif(regexp_replace(p.collector_number, '\\D', '', 'g'), '')::int nulls last, p.collector_number`,
    // The most expensive finish on the newest price day.
    price: sql`(select max(s.usd_cents) from price_snapshots s
                 where s.printing_id = p.id
                   and s.day = (select max(day) from price_snapshots)) desc nulls last, p.name`,
    mana: sql`p.mana_value, p.name, p.set_code, p.collector_number`,
  }[search.sort];
  const offset = (Math.max(1, search.page) - 1) * SEARCH_PAGE_SIZE;

  // The matching printings (narrow columns only so sorting stays in memory), or each matching
  // card's cheapest printing (unpriced ones last).
  const matching = search.oneRowPerCard
    ? sql`select distinct on (p.oracle_id)
                 p.id, p.name, p.set_code, p.collector_number, p.mana_value
            from printings p
            join card_sets s on s.code = p.set_code and s.is_enabled
           where ${where}
           order by p.oracle_id,
                    (select min(snapshot.usd_cents) from price_snapshots snapshot
                      where snapshot.printing_id = p.id
                        and snapshot.day = (select max(day) from price_snapshots)) asc nulls last,
                    p.id`
    : sql`select p.id, p.name, p.set_code, p.collector_number, p.mana_value
            from printings p
            join card_sets s on s.code = p.set_code and s.is_enabled
           where ${where}`;

  const totalQuery = search.oneRowPerCard
    ? sql`select count(distinct p.oracle_id)::int as total
            from printings p
            join card_sets s on s.code = p.set_code and s.is_enabled
           where ${where}`
    : sql`select count(*)::int as total
            from printings p
            join card_sets s on s.code = p.set_code and s.is_enabled
           where ${where}`;

  const [rows, totals] = await Promise.all([
    db.execute<{ id: string }>(sql`
      with matching as (${matching})
      select p.id from matching p
       order by ${order}
       limit ${SEARCH_PAGE_SIZE} offset ${offset}
    `),
    db.execute<{ total: number }>(totalQuery),
  ]);
  const total = totals.rows[0].total;
  return {
    printingIds: rows.rows.map((row) => row.id),
    total,
    pageCount: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
    notes,
  };
}

export type PrintingDetail = Pick<CardFacts, "typeLine"> &
  Readonly<{
    card: PrintingCard;
    setCode: string;
    setName: string;
    keyruneCode: string;
    isSetEnabled: boolean;
  }>;

/** One printing with its set, for the card page. */
export async function printingDetail(db: DbExecutor, id: string): Promise<PrintingDetail | null> {
  const [row] = (
    await db.execute<
      PrintingCardRow & {
        set_name: string;
        keyrune_code: string;
        is_enabled: boolean;
        type_line: string;
      }
    >(sql`
      select ${PRINTING_CARD_COLUMNS}, s.name as set_name, s.keyrune_code, s.is_enabled, p.type_line
        from printings p join card_sets s on s.code = p.set_code
       where p.id = ${id}
    `)
  ).rows;
  if (row === undefined) return null;
  return {
    card: toPrintingCard(row),
    setCode: row.set_code,
    setName: row.set_name,
    keyruneCode: row.keyrune_code,
    isSetEnabled: row.is_enabled,
    typeLine: row.type_line,
  };
}

export type PricePoint = Readonly<{ day: string; price: Cents }>;

/** Every daily price of a printing, per finish, oldest first (ADR 0013). */
export async function priceHistory(
  db: DbExecutor,
  id: string,
): Promise<Partial<Record<Finish, PricePoint[]>>> {
  const rows = await db.execute<{ finish: Finish; day: string; usd_cents: number }>(sql`
    select finish, day::text as day, usd_cents from price_snapshots
     where printing_id = ${id}
     order by day
  `);
  const history: Partial<Record<Finish, PricePoint[]>> = {};
  for (const row of rows.rows) {
    history[row.finish] = [
      ...(history[row.finish] ?? []),
      { day: row.day, price: Cents.of(Number(row.usd_cents)) },
    ];
  }
  return history;
}
