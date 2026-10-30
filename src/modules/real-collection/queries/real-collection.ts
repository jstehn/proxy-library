import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { parseSearch } from "@/shared/card-search";
import {
  COLLECTION_SECTIONS,
  colorFilter,
  foilCopy,
  searchCondition,
} from "@/shared/card-search/sql";
import type { UserId } from "@/shared/kernel";
import { realCards, realCollectionSettings, realProducts } from "../infrastructure/schema";
import { authUsers } from "../../accounts/infrastructure/schema";
import { sealedProducts } from "../../catalog/infrastructure/schema";

// Read models for the real collection's screens (design doc 16, section 7; ADR 0006).

type Finish = "nonfoil" | "foil" | "etched";

/** Every printing someone owns for real: priced every night although its set isn't sold. */
export async function realPrintingIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.selectDistinct({ id: realCards.printingId }).from(realCards);
  return rows.map((row) => row.id);
}

/** How the Real tab can be filtered and sorted, as the Game tab can. Empty fields don't filter. */
export type RealCollectionFilter = Readonly<{
  search?: string;
  setCode?: string;
  rarity?: string;
  color?: string;
  finish?: Finish;
  sections: keyof typeof COLLECTION_SECTIONS;
  sort: "newest" | "value" | "name" | "mana" | "set";
  page: number; // from 1
}>;

export const REAL_COLLECTION_PAGE_SIZE = 60;

export type RealCollectionRow = Readonly<{
  printingId: string;
  oracleId: string;
  finish: Finish;
  quantity: number;
  /** Latest market price of one copy in this finish, or null if there's none. */
  price: number | null;
  section: string;
}>;

export type RealCollectionPage = Readonly<{
  rows: RealCollectionRow[];
  totals: { different: number; copies: number; valueCents: number };
  pageCount: number;
  notes: readonly string[];
}>;

/** One page of a player's real collection, with the game collection's filters and sections. */
export async function realCollectionPage(
  db: DbExecutor,
  userId: UserId,
  filter: RealCollectionFilter,
): Promise<RealCollectionPage> {
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

  const [sectionOrder, sectionLabel] = COLLECTION_SECTIONS[filter.sections];
  const owned = sql`
    select c.printing_id, p.oracle_id, c.finish, c.quantity, c.added_at, p.name, p.set_code,
           p.collector_number, p.mana_value, s.release_date,
           ${sectionOrder} as section_order, ${sectionLabel} as section,
           (select ps.usd_cents from price_snapshots ps
             where ps.printing_id = c.printing_id and ps.finish = c.finish
             order by ps.day desc limit 1) as price
      from real_cards c
      join printings p on p.id = c.printing_id
      join card_sets s on s.code = p.set_code
     where ${where}`;
  const order = {
    newest: sql`added_at desc, name`,
    value: sql`price * quantity desc nulls last, name`,
    name: sql`name, set_code, finish`,
    mana: sql`mana_value, name, finish`,
    set: sql`set_code, nullif(regexp_replace(collector_number, '\\D', '', 'g'), '')::int nulls last, collector_number, finish`,
  }[filter.sort];
  const offset = (Math.max(1, filter.page) - 1) * REAL_COLLECTION_PAGE_SIZE;

  const rows = await db.execute<{
    printing_id: string;
    oracle_id: string;
    finish: Finish;
    quantity: number;
    price: number | null;
    section: string;
  }>(sql`
    select printing_id, oracle_id, finish, quantity, price, section from (${owned}) owned
     order by section_order, release_date desc, set_code, ${order}
     limit ${REAL_COLLECTION_PAGE_SIZE} offset ${offset}
  `);
  const totals = await db.execute<{ different: number; copies: number; value_cents: number }>(sql`
    select count(*)::int as different, coalesce(sum(quantity), 0)::int as copies,
           coalesce(sum(price * quantity), 0)::bigint as value_cents
      from (${owned}) owned
  `);
  const summary = totals.rows[0];
  return {
    rows: rows.rows.map((row) => ({
      printingId: row.printing_id,
      oracleId: row.oracle_id,
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
    pageCount: Math.max(1, Math.ceil(summary.different / REAL_COLLECTION_PAGE_SIZE)),
    notes: parsed.notes,
  };
}

/** How many copies of one printing a player owns for real, per finish (the card page's box). */
export async function realCopiesOf(
  db: DbExecutor,
  userId: UserId,
  printingId: string,
): Promise<Partial<Record<Finish, number>>> {
  const rows = await db
    .select({ finish: realCards.finish, quantity: realCards.quantity })
    .from(realCards)
    .where(and(eq(realCards.userId, userId), eq(realCards.printingId, printingId)));
  return Object.fromEntries(rows.map((row) => [row.finish, row.quantity]));
}

/** A row for the collection exporters (the same fields as the game collection's export). */
export type RealExportRow = Readonly<{
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
  rarity: string;
  quantity: number;
  priceCents: number | null;
  firstAcquired: string; // when the row was added
  lastAcquired: string; // when it last changed
}>;

/** Every real card a player has, for exporting, in set and number order. */
export async function realExportRows(db: DbExecutor, userId: UserId): Promise<RealExportRow[]> {
  const rows = await db.execute<{
    name: string;
    set_code: string;
    collector_number: string;
    finish: Finish;
    rarity: string;
    quantity: number;
    price: number | null;
    added_at: Date;
    updated_at: Date;
  }>(sql`
    select p.name, p.set_code, p.collector_number, c.finish, p.rarity, c.quantity, c.added_at, c.updated_at,
           (select ps.usd_cents from price_snapshots ps
             where ps.printing_id = c.printing_id and ps.finish = c.finish
             order by ps.day desc limit 1) as price
      from real_cards c join printings p on p.id = c.printing_id
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
    firstAcquired: new Date(row.added_at).toISOString(),
    lastAcquired: new Date(row.updated_at).toISOString(),
  }));
}

/** Rule 5: whether the player lets the others see their real collection (off by default). */
export async function isRealCollectionShared(db: DbExecutor, userId: UserId): Promise<boolean> {
  const [row] = await db
    .select({ isShared: realCollectionSettings.isShared })
    .from(realCollectionSettings)
    .where(eq(realCollectionSettings.userId, userId));
  return row?.isShared ?? false;
}

/** A player who lets the others see their real collection (rule 5). */
export type SharedRealCollection = Readonly<{ userId: string; displayName: string }>;

/** Every player sharing their real collection, by name. */
export async function sharedRealCollections(db: DbExecutor): Promise<SharedRealCollection[]> {
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

/** A player's real products, newest first. */
export async function realProductsOf(db: DbExecutor, userId: UserId): Promise<RealProductRow[]> {
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
    .where(eq(realProducts.userId, userId))
    .orderBy(desc(realProducts.addedAt), desc(realProducts.id));
  return rows.map((row) => ({ ...row, addedAt: row.addedAt.toISOString() }));
}

/** How many copies of each product the player owns for real (the store page's "You own 1"). */
export async function realProductCounts(
  db: DbExecutor,
  userId: UserId,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: realProducts.productId, count: sql<number>`count(*)::int` })
    .from(realProducts)
    .where(and(eq(realProducts.userId, userId), inArray(realProducts.productId, [...productIds])))
    .groupBy(realProducts.productId);
  return new Map(rows.map((row) => [row.productId, row.count]));
}

/** The sets a player's real cards are from, newest first, for the Real tab's set filter. */
export async function realCollectionSets(
  db: DbExecutor,
  userId: UserId,
): Promise<Array<{ code: string; name: string }>> {
  const rows = await db.execute<{ code: string; name: string }>(sql`
    select s.code, s.name from card_sets s
     where exists (select 1 from real_cards c join printings p on p.id = c.printing_id
                    where c.user_id = ${userId} and p.set_code = s.code)
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
           (select jsonb_object_agg(latest.finish, latest.usd_cents) from (
              select distinct on (ps.finish) ps.finish, ps.usd_cents from price_snapshots ps
               where ps.printing_id = p.id order by ps.finish, ps.day desc) latest) as prices
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
