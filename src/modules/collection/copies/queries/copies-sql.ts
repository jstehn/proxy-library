import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { latestPrice } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { Finish } from "@/shared/mtg";
import { parseSearch } from "@/shared/card-search";
import {
  COLLECTION_SECTIONS,
  colorFilter,
  foilCopy,
  searchCondition,
} from "@/modules/catalog/cards/queries/search-sql";

// How a player's cards are listed, filtered, sorted and exported, for the two collections that
// hold copies (the game collection and the real collection, design docs 7 and 16). Each module
// passes its own table as a `CopiesSource`, so this file names neither table and the real
// collection's table stays out of reach of every module but its own. Server code only.

/**
 * Where a collection's copies live. The SQL fragments read the table aliased "c": a row with
 * `user_id`, `printing_id`, `finish` and `quantity`, plus the arrival times below.
 */
export type CopiesSource = Readonly<{
  /** The table's name, as SQL. */
  table: SQL;
  /** When the newest copy of this stack arrived (the "newest first" sort). */
  newestArrival: SQL;
  /** The export's "first acquired" column. */
  firstArrival: SQL;
  /** The export's "last acquired" column. */
  lastArrival: SQL;
}>;

/** How a collection page can be filtered and sorted. Empty fields don't filter. */
export type CollectionFilter = Readonly<{
  /** Card search text, Scryfall-style (design doc 15). `is:foil` means this copy is foil. */
  search?: string;
  setCode?: string;
  rarity?: string;
  /**
   * "W", "U", "B", "R", "G" (includes that color), "C" (colorless), "M" (multicolored), or a
   * combination's code such as "GU" (exactly those colors).
   */
  color?: string;
  finish?: Finish;
  /** Only copies acquired at or after this instant. */
  addedSince?: Date;
  /** How the page is divided into sections (feedback 2026-09-27: colors matter most). */
  sections: keyof typeof COLLECTION_SECTIONS;
  /** The order within each section. */
  sort: "newest" | "value" | "price" | "name" | "mana" | "set";
  page: number; // from 1
  /** Optional override for rows per page (1–60; defaults to 60). */
  pageSize?: number;
}>;

const COLLECTION_PAGE_SIZE = 60;

export type CollectionRow = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
  /** Latest market price of one copy in this finish, or null if there's none. */
  price: number | null;
  /** The section this card is in ("Blue", "Creatures", …), or "" without sections. */
  section: string;
  /** Mana value of the printing, for cross-collection sorting. */
  manaValue: number;
  /** When the newest copy of this stack arrived, or null if unknown. */
  lastAcquiredAt: Date | null;
}>;

export type CollectionPage = Readonly<{
  rows: CollectionRow[];
  /** Over everything matching the filter, not just this page. */
  totals: { different: number; copies: number; valueCents: number };
  pageCount: number;
  /** Parts of the search that were ignored, to show under the box. */
  notes: readonly string[];
}>;

/** What a collection read gives when it may not show anything (no such owner, or not shared). */
export function emptyCollectionPage(): CollectionPage {
  return { rows: [], totals: { different: 0, copies: 0, valueCents: 0 }, pageCount: 1, notes: [] };
}

/** One row of an export: what the exporters need to know about a stack of copies. */
export type CollectionExportRow = Readonly<{
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
  rarity: string;
  quantity: number;
  priceCents: number | null;
  firstAcquired: string; // ISO date
  lastAcquired: string;
}>;

/** One printing a player owns, as the card page lists it. */
export type OwnedPrintingCopy = Readonly<{
  printingId: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
  quantity: number;
}>;

/**
 * One page of a player's collection (ADR 0006: one query, filters in SQL). The same card
 * conditions as the singles store's search, written once here because a module's queries only
 * read tables, never another module's code.
 */
export async function readCollectionPage(
  db: DbExecutor,
  userId: UserId,
  source: CopiesSource,
  filter: CollectionFilter,
): Promise<CollectionPage> {
  const parsed = parseSearch(filter.search ?? "");
  const conditions = [
    sql`c.user_id = ${userId}`,
    searchCondition(parsed.node, { userId, foil: foilCopy(sql`c.finish`) }),
  ];
  if (filter.setCode) conditions.push(sql`p.set_code = ${filter.setCode.toUpperCase()}`);
  if (filter.rarity) conditions.push(sql`p.rarity = ${filter.rarity}`);
  if (filter.finish) conditions.push(sql`c.finish = ${filter.finish}`);
  if (filter.color) conditions.push(colorFilter(filter.color));
  if (filter.addedSince) conditions.push(sql`${source.newestArrival} >= ${filter.addedSince}`);
  const where = sql.join(conditions, sql` and `);

  // The newest price of this finish; compute newest arrival only before paging when sorting or
  // filtering by it, otherwise only for the 60 rows on the page.
  const [sectionOrder, sectionLabel] = COLLECTION_SECTIONS[filter.sections];
  const needsArrivalUpfront = filter.sort === "newest" || filter.addedSince !== undefined;
  const owned = sql`
    select c.user_id, c.printing_id, c.finish, c.quantity, p.name, p.set_code, p.collector_number, p.mana_value,
           s.release_date, ${sectionOrder} as section_order, ${sectionLabel} as section,
           ${latestPrice("c.printing_id", "c.finish")} as price
           ${needsArrivalUpfront ? sql`, ${source.newestArrival} as last_acquired_at` : sql``}
      from ${source.table} c
      join printings p on p.id = c.printing_id
      join card_sets s on s.code = p.set_code
     where ${where}`;
  const order = {
    newest: sql`last_acquired_at desc nulls last, name`,
    value: sql`price * quantity desc nulls last, name`,
    price: sql`price desc nulls last, name`,
    name: sql`name, set_code, finish`,
    mana: sql`mana_value, name, finish`,
    set: sql`set_code, nullif(regexp_replace(collector_number, '\\D', '', 'g'), '')::int nulls last, collector_number, finish`,
  }[filter.sort];
  const outerOrder =
    filter.sections === "set"
      ? sql`section_order, release_date desc, set_code, ${order}`
      : sql`section_order, ${order}`;
  const pageSize = Math.min(
    COLLECTION_PAGE_SIZE,
    Math.max(1, filter.pageSize ?? COLLECTION_PAGE_SIZE),
  );
  const offset = (Math.max(1, filter.page) - 1) * pageSize;

  const pageQuery = needsArrivalUpfront
    ? sql`
      select printing_id, finish, quantity, price, section, mana_value, last_acquired_at
        from (${owned}) owned
       -- Sections first (a set's section by newest set), then the chosen order within each.
       order by ${outerOrder}
       limit ${pageSize} offset ${offset}
    `
    : sql`
      with paged as (
        select user_id, printing_id, finish, quantity, price, section, mana_value,
               section_order, release_date, set_code, name, collector_number
          from (${owned}) owned
         order by ${outerOrder}
         limit ${pageSize} offset ${offset}
      )
      select paged.printing_id, paged.finish, paged.quantity, paged.price, paged.section,
             paged.mana_value, arrival.last_acquired_at
        from paged
        join lateral (
          select ${source.newestArrival} as last_acquired_at
            from ${source.table} c
           where c.user_id = paged.user_id
             and c.printing_id = paged.printing_id
             and c.finish = paged.finish
        ) arrival on true
       order by ${outerOrder}
    `;

  const [rows, totals] = await Promise.all([
    db.execute<{
      printing_id: string;
      finish: Finish;
      quantity: number;
      price: number | null;
      section: string;
      mana_value: number;
      last_acquired_at: Date | string | null;
    }>(pageQuery),
    db.execute<{ different: number; copies: number; value_cents: number }>(sql`
      select count(*)::int as different, coalesce(sum(c.quantity), 0)::int as copies,
             coalesce(sum(${latestPrice("c.printing_id", "c.finish")} * c.quantity), 0)::bigint as value_cents
        from ${source.table} c
        join printings p on p.id = c.printing_id
        join card_sets s on s.code = p.set_code
       where ${where}
    `),
  ]);
  const summary = totals.rows[0];
  return {
    rows: rows.rows.map((row) => ({
      printingId: row.printing_id,
      finish: row.finish,
      quantity: row.quantity,
      price: row.price === null ? null : Number(row.price),
      section: row.section,
      manaValue: Number(row.mana_value),
      lastAcquiredAt:
        row.last_acquired_at === null
          ? null
          : row.last_acquired_at instanceof Date
            ? row.last_acquired_at
            : new Date(row.last_acquired_at),
    })),
    totals: {
      different: summary.different,
      copies: summary.copies,
      valueCents: Number(summary.value_cents),
    },
    pageCount: Math.max(1, Math.ceil(summary.different / pageSize)),
    notes: parsed.notes,
  };
}

/** How many copies of one printing a player owns, per finish. */
export async function readCopiesOf(
  db: DbExecutor,
  userId: UserId,
  source: CopiesSource,
  printingId: string,
): Promise<Partial<Record<Finish, number>>> {
  const rows = await db.execute<{ finish: Finish; quantity: number }>(sql`
    select c.finish, c.quantity from ${source.table} c
     where c.user_id = ${userId} and c.printing_id = ${printingId}
  `);
  return Object.fromEntries(rows.rows.map((row) => [row.finish, row.quantity]));
}

/** Every copy of a card (any printing) a player owns, in set and number order. */
export async function readOwnedByOracle(
  db: DbExecutor,
  userId: UserId,
  source: CopiesSource,
  oracleId: string,
): Promise<OwnedPrintingCopy[]> {
  const rows = await db.execute<{
    printing_id: string;
    set_code: string;
    collector_number: string;
    finish: Finish;
    quantity: number;
  }>(sql`
    select c.printing_id, p.set_code, p.collector_number, c.finish, c.quantity
      from ${source.table} c
      join printings p on p.id = c.printing_id
     where c.user_id = ${userId} and p.oracle_id = ${oracleId}
     order by p.set_code, p.collector_number, c.finish
  `);
  return rows.rows.map((row) => ({
    printingId: row.printing_id,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    finish: row.finish,
    quantity: row.quantity,
  }));
}

/** Every card a player has, with what the exporters need, in set and number order. */
export async function readCollectionExport(
  db: DbExecutor,
  userId: UserId,
  source: CopiesSource,
): Promise<CollectionExportRow[]> {
  const rows = await db.execute<{
    name: string;
    set_code: string;
    collector_number: string;
    finish: Finish;
    rarity: string;
    quantity: number;
    price: number | null;
    first_acquired: Date | null;
    last_acquired: Date | null;
  }>(sql`
    select p.name, p.set_code, p.collector_number, c.finish, p.rarity, c.quantity,
           ${latestPrice("c.printing_id", "c.finish")} as price,
           ${source.firstArrival} as first_acquired,
           ${source.lastArrival} as last_acquired
      from ${source.table} c join printings p on p.id = c.printing_id
     where c.user_id = ${userId}
     order by p.set_code, nullif(regexp_replace(p.collector_number, '\\D', '', 'g'), '')::int nulls last,
              p.collector_number, c.finish
  `);
  return rows.rows.map((row) => ({
    name: row.name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    finish: row.finish,
    rarity: row.rarity,
    quantity: row.quantity,
    priceCents: row.price === null ? null : Number(row.price),
    firstAcquired: new Date(row.first_acquired ?? 0).toISOString(),
    lastAcquired: new Date(row.last_acquired ?? 0).toISOString(),
  }));
}
