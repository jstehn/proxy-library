import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Actor } from "@/modules/accounts";
import { type DbExecutor, latestPricesByFinish } from "@/shared/db";
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
} from "@/shared/card-search/sql-collection";
import { type Finish, type UserId } from "@/shared/kernel";
import { realCollectionSettings, realProducts } from "../infrastructure/schema";
import { authUsers } from "../../accounts/infrastructure/schema";
import { sealedProducts } from "../../catalog/infrastructure/schema";

// Read models for the real collection's screens (design doc 16, section 7; ADR 0006). Listing,
// filtering and exporting are shared with the game collection (@/shared/card-search/sql-collection);
// this file says where the real copies live. A real row has no acquisitions: it was added once and
// changes in place.

export type RealCollectionFilter = CollectionFilter;
export type RealCollectionRow = CollectionRow;
export type RealCollectionPage = CollectionPage;

const REAL_COPIES: CopiesSource = {
  table: sql`real_cards`,
  newestArrival: sql`c.added_at`,
  firstArrival: sql`c.added_at`,
  lastArrival: sql`c.updated_at`,
};

/**
 * Rule 5, in SQL (design doc 67, F1): a real collection is visible to its owner, and to everyone
 * else only while the owner shares it. Every read of someone's real collection carries this.
 */
function visibleTo(actor: Actor, ownerId: UserId): SQL {
  return sql`(${ownerId} = ${actor.userId} or exists (
    select 1 from real_collection_settings shared
     where shared.user_id = ${ownerId} and shared.is_shared))`;
}

async function mayView(db: DbExecutor, actor: Actor, ownerId: UserId): Promise<boolean> {
  const rows = await db.execute<{ visible: boolean }>(
    sql`select ${visibleTo(actor, ownerId)} as visible`,
  );
  return rows.rows[0]?.visible === true;
}

/**
 * One page of `ownerId`'s real collection, with the game collection's filters and sections (kind
 * S): your own, or another player's while they share it; otherwise an empty page.
 */
export async function page(
  db: DbExecutor,
  actor: Actor,
  ownerId: UserId,
  filter: RealCollectionFilter,
): Promise<RealCollectionPage> {
  if (!(await mayView(db, actor, ownerId))) return emptyCollectionPage();
  return readCollectionPage(db, ownerId, REAL_COPIES, filter);
}

/** How many copies of one printing the actor owns for real, per finish (the card page's box). */
export function copiesOf(
  db: DbExecutor,
  actor: Actor,
  printingId: string,
): Promise<Partial<Record<Finish, number>>> {
  return readCopiesOf(db, actor.userId, REAL_COPIES, printingId);
}

/** Every real card the actor has, for exporting, in set and number order. */
export function exportRows(db: DbExecutor, actor: Actor): Promise<CollectionExportRow[]> {
  return readCollectionExport(db, actor.userId, REAL_COPIES);
}

/** Rule 5: whether the actor lets the others see their real collection (off by default). */
export async function isShared(db: DbExecutor, actor: Actor): Promise<boolean> {
  const [row] = await db
    .select({ isShared: realCollectionSettings.isShared })
    .from(realCollectionSettings)
    .where(eq(realCollectionSettings.userId, actor.userId));
  return row?.isShared ?? false;
}

/** A player who lets the others see their real collection (rule 5). */
export type SharedRealCollection = Readonly<{ userId: string; displayName: string }>;

/** Every player sharing their real collection, by name. */
export async function shared(db: DbExecutor): Promise<SharedRealCollection[]> {
  const rows = await db
    .select({ userId: realCollectionSettings.userId, displayName: authUsers.name })
    .from(realCollectionSettings)
    .innerJoin(authUsers, eq(authUsers.id, realCollectionSettings.userId))
    .where(eq(realCollectionSettings.isShared, true))
    .orderBy(authUsers.name);
  return rows;
}

/** A product the player owns for real, as the Real tab lists it. */
export type RealProductRow = Readonly<{
  id: number;
  productId: string;
  name: string;
  setCode: string;
  addedAt: string;
}>;

/** `ownerId`'s real products, newest first (kind S: the owner, or anyone while they share). */
export async function productsOf(
  db: DbExecutor,
  actor: Actor,
  ownerId: UserId,
): Promise<RealProductRow[]> {
  const rows = await db
    .select({
      id: realProducts.id,
      productId: realProducts.productId,
      name: sealedProducts.name,
      setCode: sealedProducts.setCode,
      addedAt: realProducts.addedAt,
    })
    .from(realProducts)
    .innerJoin(sealedProducts, eq(sealedProducts.id, realProducts.productId))
    .where(and(eq(realProducts.userId, ownerId), visibleTo(actor, ownerId)))
    .orderBy(desc(realProducts.addedAt), desc(realProducts.id));
  return rows.map((row) => ({ ...row, addedAt: row.addedAt.toISOString() }));
}

/** How many copies of each product the actor owns for real (the store page's "You own 1"). */
export async function productCounts(
  db: DbExecutor,
  actor: Actor,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: realProducts.productId, count: sql<number>`count(*)::int` })
    .from(realProducts)
    .where(
      and(eq(realProducts.userId, actor.userId), inArray(realProducts.productId, [...productIds])),
    )
    .groupBy(realProducts.productId);
  return new Map(rows.map((row) => [row.productId, row.count]));
}

/** The sets `ownerId`'s real cards are from, newest first, for the Real tab's set filter (kind S). */
export async function sets(
  db: DbExecutor,
  actor: Actor,
  ownerId: UserId,
): Promise<Array<{ code: string; name: string }>> {
  const rows = await db.execute<{ code: string; name: string }>(sql`
    select s.code, s.name from card_sets s
     where exists (select 1 from real_cards c join printings p on p.id = c.printing_id
                    where c.user_id = ${ownerId} and p.set_code = s.code)
       and ${visibleTo(actor, ownerId)}
     order by s.release_date desc, s.code
  `);
  return rows.rows;
}

/** One printing a preview line could be changed to (the printing menu). */
export type PrintingChoice = Readonly<{
  printingId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  variantLabel: string;
  finishes: Finish[];
  /** Latest nonfoil-or-first-finish price, for the preview's value column. */
  prices: Partial<Record<Finish, number>>;
}>;

/** Every printing of these cards, newest first, for the import preview's printing menus. */
export async function printingChoices(
  db: DbExecutor,
  oracleIds: readonly string[],
): Promise<Map<string, PrintingChoice[]>> {
  if (oracleIds.length === 0) return new Map();
  const rows = await db.execute<{
    oracle_id: string;
    id: string;
    name: string;
    set_code: string;
    set_name: string;
    collector_number: string;
    variant_label: string;
    finishes: Finish[];
    prices: Partial<Record<Finish, number>> | null;
  }>(sql`
    select p.oracle_id, p.id, p.name, p.set_code, s.name as set_name, p.collector_number,
           p.variant_label, p.finishes,
           ${latestPricesByFinish("p.id")} as prices
      from printings p join card_sets s on s.code = p.set_code
     where p.oracle_id = any(${sql.param([...new Set(oracleIds)])}::text[])
     order by s.release_date desc, p.set_code,
              nullif(regexp_replace(p.collector_number, '\\D', '', 'g'), '')::int nulls last, p.collector_number
  `);
  const choices = new Map<string, PrintingChoice[]>();
  for (const row of rows.rows) {
    const choice: PrintingChoice = {
      printingId: row.id,
      name: row.name,
      setCode: row.set_code,
      setName: row.set_name,
      collectorNumber: row.collector_number,
      variantLabel: row.variant_label,
      finishes: row.finishes,
      prices: row.prices ?? {},
    };
    choices.set(row.oracle_id, [...(choices.get(row.oracle_id) ?? []), choice]);
  }
  return choices;
}

/** Every copy of a card (any printing) the actor owns in their real collection. */
export function ownedByOracle(
  db: DbExecutor,
  actor: Actor,
  oracleId: string,
): Promise<OwnedPrintingCopy[]> {
  return readOwnedByOracle(db, actor.userId, REAL_COPIES, oracleId);
}

/** Every printing of the same card as this one, for moving real copies between printings. */
export async function printingsOfSameCard(
  db: DbExecutor,
  printingId: string,
): Promise<PrintingChoice[]> {
  const [row] = (
    await db.execute<{ oracle_id: string }>(
      sql`select oracle_id from printings where id = ${printingId}`,
    )
  ).rows;
  if (row === undefined) return [];
  return (await printingChoices(db, [row.oracle_id])).get(row.oracle_id) ?? [];
}
