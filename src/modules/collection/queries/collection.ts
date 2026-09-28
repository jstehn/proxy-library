import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { COLOR_COMBINATIONS, colorCombination, type ManaColor, type UserId } from "@/shared/kernel";
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
  name?: string;
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

/** SQL: printing "p" has exactly these colors. */
function hasExactly(colors: readonly ManaColor[]): SQL {
  const array = sql.join(
    colors.map((color) => sql`${color}`),
    sql`, `,
  );
  return sql`(cardinality(p.colors) = ${colors.length} and p.colors @> array[${array}]::text[])`;
}

/** SQL: a multicolored printing's combination, as `pick` gives it (its position or its label). */
function combinationOf(pick: (index: number, label: string) => SQL): SQL {
  const whens = COLOR_COMBINATIONS.map(
    (combination, index) =>
      sql`when ${hasExactly(combination.colors)} then ${pick(index, combination.label)}`,
  );
  return sql`(case ${sql.join(whens, sql` `)} end)`;
}

/** Section keys in SQL, on printings aliased "p": [order, label] for each way of dividing. */
const SECTIONS = {
  none: [sql`0`, sql`''`],
  // Binder order: each color, then each multicolored combination (guilds, shards, wedges, four
  // and five colors), colorless, and lands.
  color: [
    sql`case when p.type_line ~ '\\yLand\\y' and cardinality(p.colors) = 0 then 60
             when cardinality(p.colors) > 1 then ${combinationOf((index) => sql.raw(String(10 + index)))}
             when cardinality(p.colors) = 0 then 50
             else array_position(array['W','U','B','R','G'], p.colors[1]) end`,
    sql`case when p.type_line ~ '\\yLand\\y' and cardinality(p.colors) = 0 then 'Lands'
             when cardinality(p.colors) > 1 then ${combinationOf((_, label) => sql`${label}::text`)}
             when cardinality(p.colors) = 0 then 'Colorless'
             else (array['White','Blue','Black','Red','Green'])[array_position(array['W','U','B','R','G'], p.colors[1])] end`,
  ],
  // The first matching type, in the order players usually sort a collection.
  type: [
    sql`coalesce(array_position(array['Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land'],
          (select t from unnest(array['Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land']) with ordinality as types(t, n)
            where p.type_line ~ ('\\y' || t || '\\y') order by n limit 1)), 9)`,
    sql`coalesce((select t || 's' from unnest(array['Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land']) with ordinality as types(t, n)
            where p.type_line ~ ('\\y' || t || '\\y') order by n limit 1), 'Other')`,
  ],
  rarity: [
    sql`coalesce(array_position(array['mythic','rare','uncommon','common'], p.rarity), 5)`,
    sql`initcap(p.rarity)`,
  ],
  set: [sql`0`, sql`s.name`],
} as const;

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
  const combination = filter.color ? colorCombination(filter.color) : undefined;
  if (filter.color === "C") conditions.push(sql`cardinality(p.colors) = 0`);
  else if (filter.color === "M") conditions.push(sql`cardinality(p.colors) > 1`);
  else if (combination) conditions.push(hasExactly(combination.colors));
  else if (filter.color) conditions.push(sql`${filter.color} = any(p.colors)`);
  const where = sql.join(conditions, sql` and `);

  // The newest price of this finish, and the newest arrival of this stack.
  const [sectionOrder, sectionLabel] = SECTIONS[filter.sections];
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
