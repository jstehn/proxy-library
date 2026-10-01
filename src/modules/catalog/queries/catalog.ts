import { count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents, colorCombination, type ManaColor } from "@/shared/kernel";
import type { CardFace, Finish } from "../domain/types";
import { cardSets, printings, syncRuns } from "../infrastructure/schema";

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

export async function listSetsForAdmin(db: DbExecutor): Promise<AdminSetRow[]> {
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
      printingCount: count(printings.id),
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

export type PrintingCard = Readonly<{
  id: string;
  name: string;
  collectorNumber: string;
  rarity: string;
  variantLabel: string;
  finishes: Finish[];
  hasImage: boolean;
  /** Whether it has a second card face with its own image (double-faced cards, not split ones). */
  hasBackImage: boolean;
  /** What's printed on each face (front first), for the hover overlay. */
  faces: CardFace[];
  artist: string | null;
  /** Latest market price per finish; a finish is missing when there's no price. */
  prices: Partial<Record<Finish, Cents>>;
}>;

type PrintingCardRow = {
  id: string;
  name: string;
  collector_number: string;
  rarity: string;
  variant_label: string;
  finishes: Finish[];
  has_image: boolean;
  has_back_image: boolean;
  faces: CardFace[];
  artist: string | null;
  prices: Record<string, number> | null;
};

/** The columns of a PrintingCard, for printings aliased "p". */
const PRINTING_CARD_COLUMNS = sql`
  p.id, p.name, p.collector_number, p.rarity, p.variant_label, p.finishes,
  p.image_uris is not null as has_image,
  coalesce(jsonb_typeof(p.image_uris->'back') = 'object', false) as has_back_image,
  p.faces, p.artist,
  -- For each finish, the newest snapshot's price ("distinct on" keeps the first row per finish).
  (select jsonb_object_agg(latest.finish, latest.usd_cents)
     from (select distinct on (s.finish) s.finish, s.usd_cents
             from price_snapshots s
            where s.printing_id = p.id
            order by s.finish, s.day desc) latest) as prices`;

function toPrintingCard(row: PrintingCardRow): PrintingCard {
  return {
    id: row.id,
    name: row.name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    variantLabel: row.variant_label,
    finishes: row.finishes,
    hasImage: row.has_image,
    hasBackImage: row.has_back_image,
    faces: row.faces,
    artist: row.artist,
    prices: Object.fromEntries(
      Object.entries(row.prices ?? {}).map(([finish, cents]) => [finish, Cents.of(Number(cents))]),
    ),
  };
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

/** These printings (any set), by id. Ids the catalog doesn't have are left out. */
export async function printingCards(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, PrintingCard>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<PrintingCardRow>(sql`
    select ${PRINTING_CARD_COLUMNS}
      from printings p
     where p.id = any(${sql.param([...new Set(ids)])}::text[])
  `);
  return new Map(rows.rows.map((row) => [row.id, toPrintingCard(row)]));
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

export async function recentSyncRuns(db: DbExecutor, limit = 20): Promise<SyncRunRow[]> {
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
  name?: string;
  setCode?: string;
  rarity?: string;
  /**
   * "W", "U", "B", "R", "G" (includes that color), "C" (colorless), "M" (multicolored), or a
   * combination's code such as "GU" (exactly those colors).
   */
  color?: string;
  sort: "name" | "number" | "price";
  page: number; // from 1
}>;

export const SEARCH_PAGE_SIZE = 60;

/** SQL: printing "p" has exactly these colors. */
function hasExactly(colors: readonly ManaColor[]): SQL {
  const array = sql.join(
    colors.map((color) => sql`${color}`),
    sql`, `,
  );
  return sql`(cardinality(p.colors) = ${colors.length} and p.colors @> array[${array}]::text[])`;
}

/** SQL conditions for a search, on printings aliased "p". */
function printingConditions(search: PrintingSearch) {
  const conditions = [sql`true`];
  if (search.name) conditions.push(sql`p.name ilike ${`%${search.name}%`}`);
  if (search.setCode) conditions.push(sql`p.set_code = ${search.setCode.toUpperCase()}`);
  if (search.rarity) conditions.push(sql`p.rarity = ${search.rarity}`);
  const combination = search.color ? colorCombination(search.color) : undefined;
  if (search.color === "C") conditions.push(sql`cardinality(p.colors) = 0`);
  else if (search.color === "M") conditions.push(sql`cardinality(p.colors) > 1`);
  else if (combination) conditions.push(hasExactly(combination.colors));
  else if (search.color) conditions.push(sql`${search.color} = any(p.colors)`);
  return sql.join(conditions, sql` and `);
}

export type SearchResult = Readonly<{ printingIds: string[]; total: number; pageCount: number }>;

/**
 * Printings in enabled sets matching a search, one page at a time (the singles store). Returns
 * ids in order; `printingCards` supplies what to show for them.
 */
export async function searchPrintings(
  db: DbExecutor,
  search: PrintingSearch,
): Promise<SearchResult> {
  const where = printingConditions(search);
  const order = {
    name: sql`p.name, p.set_code, p.collector_number`,
    number: sql`p.set_code, nullif(regexp_replace(p.collector_number, '\\D', '', 'g'), '')::int nulls last, p.collector_number`,
    // The most expensive finish on the newest price day.
    price: sql`(select max(s.usd_cents) from price_snapshots s
                 where s.printing_id = p.id
                   and s.day = (select max(day) from price_snapshots)) desc nulls last, p.name`,
  }[search.sort];
  const offset = (Math.max(1, search.page) - 1) * SEARCH_PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    db.execute<{ id: string }>(sql`
      select p.id from printings p join card_sets s on s.code = p.set_code and s.is_enabled
       where ${where}
       order by ${order}
       limit ${SEARCH_PAGE_SIZE} offset ${offset}
    `),
    db.execute<{ total: number }>(sql`
      select count(*)::int as total from printings p
        join card_sets s on s.code = p.set_code and s.is_enabled
       where ${where}
    `),
  ]);
  const total = totals.rows[0].total;
  return {
    printingIds: rows.rows.map((row) => row.id),
    total,
    pageCount: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
  };
}

export type PrintingDetail = Readonly<{
  card: PrintingCard;
  setCode: string;
  setName: string;
  keyruneCode: string;
  isSetEnabled: boolean;
  typeLine: string;
}>;

/** One printing with its set, for the card page. */
export async function printingDetail(db: DbExecutor, id: string): Promise<PrintingDetail | null> {
  const card = (await printingCards(db, [id])).get(id);
  if (card === undefined) return null;
  const [row] = (
    await db.execute<{
      set_code: string;
      set_name: string;
      keyrune_code: string;
      is_enabled: boolean;
      type_line: string;
    }>(sql`
      select s.code as set_code, s.name as set_name, s.keyrune_code, s.is_enabled, p.type_line
        from printings p join card_sets s on s.code = p.set_code
       where p.id = ${id}
    `)
  ).rows;
  return {
    card,
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
