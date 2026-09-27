import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
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
  name?: string;
  setCode?: string;
  rarity?: string;
  /** "W", "U", "B", "R", "G", "C" (colorless) or "M" (multicolored). */
  color?: string;
  finish?: "nonfoil" | "foil" | "etched";
  sort: "newest" | "value" | "name" | "set";
  page: number; // from 1
}>;

export const COLLECTION_PAGE_SIZE = 60;

export type CollectionRow = Readonly<{
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
  /** Latest market price of one copy in this finish, or null if there's none. */
  price: number | null;
}>;

export type CollectionPage = Readonly<{
  rows: CollectionRow[];
  /** Over everything matching the filter, not just this page. */
  totals: { different: number; copies: number; valueCents: number };
  pageCount: number;
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
  const conditions = [sql`c.user_id = ${userId}`];
  if (filter.name) conditions.push(sql`p.name ilike ${`%${filter.name}%`}`);
  if (filter.setCode) conditions.push(sql`p.set_code = ${filter.setCode.toUpperCase()}`);
  if (filter.rarity) conditions.push(sql`p.rarity = ${filter.rarity}`);
  if (filter.finish) conditions.push(sql`c.finish = ${filter.finish}`);
  if (filter.color === "C") conditions.push(sql`cardinality(p.colors) = 0`);
  else if (filter.color === "M") conditions.push(sql`cardinality(p.colors) > 1`);
  else if (filter.color) conditions.push(sql`${filter.color} = any(p.colors)`);
  const where = sql.join(conditions, sql` and `);

  // The newest price of this finish, and the newest arrival of this stack.
  const owned = sql`
    select c.printing_id, c.finish, c.quantity, p.name, p.set_code, p.collector_number,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = c.printing_id and s.finish = c.finish
             order by s.day desc limit 1) as price,
           (select max(a.created_at) from acquisitions a
             where a.user_id = c.user_id and a.printing_id = c.printing_id
               and a.finish = c.finish) as last_acquired_at
      from collection_cards c
      join printings p on p.id = c.printing_id
     where ${where}`;
  const order = {
    newest: sql`last_acquired_at desc nulls last, name`,
    value: sql`price * quantity desc nulls last, name`,
    name: sql`name, set_code, finish`,
    set: sql`set_code, nullif(regexp_replace(collector_number, '\\D', '', 'g'), '')::int nulls last, collector_number, finish`,
  }[filter.sort];
  const offset = (Math.max(1, filter.page) - 1) * COLLECTION_PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    db.execute<{
      printing_id: string;
      finish: CollectionRow["finish"];
      quantity: number;
      price: number | null;
    }>(sql`
      select printing_id, finish, quantity, price from (${owned}) owned
       order by ${order}
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
    })),
    totals: {
      different: summary.different,
      copies: summary.copies,
      valueCents: Number(summary.value_cents),
    },
    pageCount: Math.max(1, Math.ceil(summary.different / COLLECTION_PAGE_SIZE)),
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
