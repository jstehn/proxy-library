import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { parseSearch } from "@/shared/card-search";
import {
  COLLECTION_SECTIONS,
  colorFilter,
  foilCopy,
  searchCondition,
} from "@/shared/card-search/sql";
import type { UserId } from "@/shared/kernel";
import type { ExportRow } from "../domain/export";
import { acquisitions, collectionCards } from "../infrastructure/schema";

// Read models for the collection screens (ADR 0006).

export type OwnedCard = Readonly<{
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
  /** When the newest copy arrived, as an ISO string. */
  lastAcquiredAt: string;
}>;

/** Everything a player owns, newest arrivals first. */
export async function collectionFor(db: DbExecutor, userId: UserId): Promise<OwnedCard[]> {
  const rows = await db
    .select({
      printingId: collectionCards.printingId,
      finish: collectionCards.finish,
      quantity: collectionCards.quantity,
      lastAcquiredAt: sql<string>`max(${acquisitions.createdAt})`,
    })
    .from(collectionCards)
    .leftJoin(
      acquisitions,
      and(
        eq(acquisitions.userId, collectionCards.userId),
        eq(acquisitions.printingId, collectionCards.printingId),
        eq(acquisitions.finish, collectionCards.finish),
      ),
    )
    .where(eq(collectionCards.userId, userId))
    .groupBy(collectionCards.userId, collectionCards.printingId, collectionCards.finish)
    .orderBy(desc(sql`max(${acquisitions.createdAt})`));

  return rows.map((row) => ({
    printingId: row.printingId,
    // The database only allows these three (a CHECK constraint).
    finish: row.finish as OwnedCard["finish"],
    quantity: row.quantity,
    lastAcquiredAt: new Date(row.lastAcquiredAt).toISOString(),
  }));
}

/** How the collection page can be filtered and sorted. Empty fields don't filter. */
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
  finish?: "nonfoil" | "foil" | "etched";
  /** How the page is divided into sections (feedback 2026-09-27: colors matter most). */
  sections: "none" | "color" | "type" | "rarity" | "set";
  /** The order within each section. */
  sort: "newest" | "value" | "name" | "mana" | "set";
  page: number; // from 1
}>;

export const COLLECTION_PAGE_SIZE = 60;

export type CollectionRow = Readonly<{
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
  /** Latest market price of one copy in this finish, or null if there's none. */
  price: number | null;
  /** The section this card is in ("Blue", "Creatures", …), or "" without sections. */
  section: string;
}>;

export type CollectionPage = Readonly<{
  rows: CollectionRow[];
  /** Over everything matching the filter, not just this page. */
  totals: { different: number; copies: number; valueCents: number };
  pageCount: number;
  /** Parts of the search that were ignored, to show under the box. */
  notes: readonly string[];
}>;

/**
 * One page of a player's collection (ADR 0006: one query, filters in SQL). The same card
 * conditions as the singles store's search (catalog), written here because a module's queries
 * only read tables, never another module's code.
 */
export async function collectionPage(
  db: DbExecutor,
  userId: UserId,
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
  const where = sql.join(conditions, sql` and `);

  // The newest price of this finish, and the newest arrival of this stack.
  const [sectionOrder, sectionLabel] = COLLECTION_SECTIONS[filter.sections];
  const owned = sql`
    select c.printing_id, c.finish, c.quantity, p.name, p.set_code, p.collector_number, p.mana_value,
           s.release_date, ${sectionOrder} as section_order, ${sectionLabel} as section,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = c.printing_id and s.finish = c.finish
             order by s.day desc limit 1) as price,
           (select max(a.created_at) from acquisitions a
             where a.user_id = c.user_id and a.printing_id = c.printing_id
               and a.finish = c.finish) as last_acquired_at
      from collection_cards c
      join printings p on p.id = c.printing_id
      join card_sets s on s.code = p.set_code
     where ${where}`;
  const order = {
    newest: sql`last_acquired_at desc nulls last, name`,
    value: sql`price * quantity desc nulls last, name`,
    name: sql`name, set_code, finish`,
    mana: sql`mana_value, name, finish`,
    set: sql`set_code, nullif(regexp_replace(collector_number, '\\D', '', 'g'), '')::int nulls last, collector_number, finish`,
  }[filter.sort];
  const offset = (Math.max(1, filter.page) - 1) * COLLECTION_PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    db.execute<{
      printing_id: string;
      finish: CollectionRow["finish"];
      quantity: number;
      price: number | null;
      section: string;
    }>(sql`
      select printing_id, finish, quantity, price, section from (${owned}) owned
       -- Sections first (a set's section by newest set), then the chosen order within each.
       order by section_order, release_date desc, set_code, ${order}
       limit ${COLLECTION_PAGE_SIZE} offset ${offset}
    `),
    db.execute<{ different: number; copies: number; value_cents: number }>(sql`
      select count(*)::int as different, coalesce(sum(quantity), 0)::int as copies,
             coalesce(sum(price * quantity), 0)::bigint as value_cents
        from (${owned}) owned
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
    })),
    totals: {
      different: summary.different,
      copies: summary.copies,
      valueCents: Number(summary.value_cents),
    },
    pageCount: Math.max(1, Math.ceil(summary.different / COLLECTION_PAGE_SIZE)),
    notes: parsed.notes,
  };
}

/** How many copies of one printing a player owns, per finish. */
export async function ownedCopies(
  db: DbExecutor,
  userId: UserId,
  printingId: string,
): Promise<Partial<Record<"nonfoil" | "foil" | "etched", number>>> {
  const rows = await db
    .select({ finish: collectionCards.finish, quantity: collectionCards.quantity })
    .from(collectionCards)
    .where(and(eq(collectionCards.userId, userId), eq(collectionCards.printingId, printingId)));
  return Object.fromEntries(rows.map((row) => [row.finish, row.quantity]));
}

export type OwnedPrintingCopy = Readonly<{
  printingId: string;
  setCode: string;
  collectorNumber: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
}>;

/** Every copy of a card (any printing) a player owns in their game collection. */
export async function ownedByOracle(
  db: DbExecutor,
  userId: UserId,
  oracleId: string,
): Promise<OwnedPrintingCopy[]> {
  const rows = await db.execute<{
    printing_id: string;
    set_code: string;
    collector_number: string;
    finish: "nonfoil" | "foil" | "etched";
    quantity: number;
  }>(sql`
    select c.printing_id, p.set_code, p.collector_number, c.finish, c.quantity
      from collection_cards c
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

/** Every card a player owns, with what the exporters need, in set and number order. */
export async function exportRows(db: DbExecutor, userId: UserId): Promise<ExportRow[]> {
  const rows = await db.execute<{
    name: string;
    set_code: string;
    collector_number: string;
    finish: ExportRow["finish"];
    rarity: string;
    quantity: number;
    price: number | null;
    first_acquired: Date;
    last_acquired: Date;
  }>(sql`
    select p.name, p.set_code, p.collector_number, c.finish, p.rarity, c.quantity,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = c.printing_id and s.finish = c.finish
             order by s.day desc limit 1) as price,
           (select min(a.created_at) from acquisitions a
             where a.user_id = c.user_id and a.printing_id = c.printing_id and a.finish = c.finish) as first_acquired,
           (select max(a.created_at) from acquisitions a
             where a.user_id = c.user_id and a.printing_id = c.printing_id and a.finish = c.finish) as last_acquired
      from collection_cards c join printings p on p.id = c.printing_id
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
