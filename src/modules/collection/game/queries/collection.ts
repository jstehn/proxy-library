import { sql } from "drizzle-orm";
import type { Actor } from "@/modules/accounts";
import { type DbExecutor, newestDayPrices } from "@/shared/db";
import {
  type CollectionExportRow,
  type CollectionFilter,
  type CollectionPage,
  type CollectionRow,
  type CopiesSource,
  type OwnedPrintingCopy,
  emptyCollectionPage,
  readCollectionExport,
  readCollectionPage,
  readCopiesOf,
  readOwnedByOracle,
} from "@/modules/collection/copies";
import { type UserId } from "@/shared/kernel";
import { type Finish } from "@/shared/mtg";

// Read models for the collection screens (ADR 0006). Listing, filtering and exporting are shared
// with the real collection (copies-sql.ts); this file says where the game's
// copies live.

export type { CollectionFilter, CollectionPage, CollectionRow, OwnedPrintingCopy };

/** Each stack's arrivals are the acquisitions that put its copies here. */
function arrivalOf(aggregate: "min" | "max") {
  return sql`(select ${sql.raw(aggregate)}(a.created_at) from acquisitions a
             where a.user_id = c.user_id and a.printing_id = c.printing_id and a.finish = c.finish)`;
}

const GAME_COPIES: CopiesSource = {
  table: sql`collection_cards`,
  newestArrival: arrivalOf("max"),
  firstArrival: arrivalOf("min"),
  lastArrival: arrivalOf("max"),
};

/** One page of the actor's collection (kind P). */
export function page(
  db: DbExecutor,
  actor: Actor,
  filter: CollectionFilter,
): Promise<CollectionPage> {
  return readCollectionPage(db, actor.userId, GAME_COPIES, filter);
}

/**
 * One page of a trading partner's game collection (kind S). The owner chose to keep every active
 * player's collection visible to every signed-in player for trading (design doc 10, rule 2; doc 67
 * F5), so the rule here is "an active player other than you"; anyone else gives an empty page.
 */
export async function pageOfPartner(
  db: DbExecutor,
  actor: Actor,
  partnerId: UserId,
  filter: CollectionFilter,
): Promise<CollectionPage> {
  const partner = await db.execute(sql`
    select 1 from players
     where user_id = ${partnerId} and disabled_at is null and user_id <> ${actor.userId}
  `);
  if (partner.rows.length === 0) {
    return emptyCollectionPage();
  }
  return readCollectionPage(db, partnerId, GAME_COPIES, filter);
}

/** How many copies of one printing the actor owns, per finish. */
export function ownedCopies(
  db: DbExecutor,
  actor: Actor,
  printingId: string,
): Promise<Partial<Record<Finish, number>>> {
  return readCopiesOf(db, actor.userId, GAME_COPIES, printingId);
}

/** How many copies the actor owns for a batch of printings, keyed by `${printingId}/${finish}`. */
export async function ownedCounts(
  db: DbExecutor,
  actor: Actor,
  printingIds: readonly string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(printingIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.execute<{ printing_id: string; finish: string; quantity: number }>(sql`
    select printing_id, finish, quantity
      from collection_cards
     where user_id = ${actor.userId}
       and printing_id = any(${sql.param(unique)}::text[])
       and quantity > 0
  `);
  return new Map(rows.rows.map((row) => [`${row.printing_id}/${row.finish}`, row.quantity]));
}

/** Every copy of a card (any printing) the actor owns in their game collection. */
export function ownedByOracle(
  db: DbExecutor,
  actor: Actor,
  oracleId: string,
): Promise<OwnedPrintingCopy[]> {
  return readOwnedByOracle(db, actor.userId, GAME_COPIES, oracleId);
}

/** Every card the actor owns, with what the exporters need, in set and number order. */
export function exportRows(db: DbExecutor, actor: Actor): Promise<CollectionExportRow[]> {
  return readCollectionExport(db, actor.userId, GAME_COPIES);
}

type DuplicateStack = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
  name: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  marketCents: number | null;
}>;

/**
 * Every stack in the actor's game collection with more than `keep` copies, paired with its latest
 * market price so the duplicate sell cart can stage extras in one click.
 */
export async function duplicateStacks(
  db: DbExecutor,
  actor: Actor,
  keep: number,
): Promise<DuplicateStack[]> {
  const rows = await db.execute<{
    printing_id: string;
    finish: Finish;
    quantity: number;
    name: string;
    set_code: string;
    collector_number: string;
    rarity: string;
    usd_cents: string | number | null;
  }>(sql`
    select c.printing_id, c.finish, c.quantity, p.name, p.set_code, p.collector_number, p.rarity,
           s.usd_cents
      from collection_cards c
      join printings p on p.id = c.printing_id
      left join ${newestDayPrices()} s on s.printing_id = c.printing_id and s.finish = c.finish
     where c.user_id = ${actor.userId}
       and c.quantity > ${keep}
     order by coalesce(s.usd_cents, 0) desc, p.name asc
  `);
  return rows.rows.map((row) => ({
    printingId: row.printing_id,
    finish: row.finish,
    quantity: row.quantity,
    name: row.name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    marketCents: row.usd_cents === null ? null : Number(row.usd_cents),
  }));
}
