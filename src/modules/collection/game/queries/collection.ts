import { sql } from "drizzle-orm";
import type { Actor } from "@/modules/accounts";
import type { DbExecutor } from "@/shared/db";
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
import { type Finish, type UserId } from "@/shared/kernel";

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
