import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import {
  type CollectionExportRow,
  type CollectionFilter,
  type CollectionPage,
  type CollectionRow,
  type CopiesSource,
  type OwnedPrintingCopy,
  readCollectionExport,
  readCollectionPage,
  readCopiesOf,
  readOwnedByOracle,
} from "@/shared/card-search/sql-collection";
import { type Finish, type UserId } from "@/shared/kernel";

// Read models for the collection screens (ADR 0006). Listing, filtering and exporting are shared
// with the real collection (@/shared/card-search/sql-collection); this file says where the game's
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

/** One page of a player's collection. */
export function collectionPage(
  db: DbExecutor,
  userId: UserId,
  filter: CollectionFilter,
): Promise<CollectionPage> {
  return readCollectionPage(db, userId, GAME_COPIES, filter);
}

/** How many copies of one printing a player owns, per finish. */
export function ownedCopies(
  db: DbExecutor,
  userId: UserId,
  printingId: string,
): Promise<Partial<Record<Finish, number>>> {
  return readCopiesOf(db, userId, GAME_COPIES, printingId);
}

/** Every copy of a card (any printing) a player owns in their game collection. */
export function ownedByOracle(
  db: DbExecutor,
  userId: UserId,
  oracleId: string,
): Promise<OwnedPrintingCopy[]> {
  return readOwnedByOracle(db, userId, GAME_COPIES, oracleId);
}

/** Every card a player owns, with what the exporters need, in set and number order. */
export function exportRows(db: DbExecutor, userId: UserId): Promise<CollectionExportRow[]> {
  return readCollectionExport(db, userId, GAME_COPIES);
}
