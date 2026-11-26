import { sql } from "drizzle-orm";
import { type DbExecutor, newestDayPrices } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import {
  COMMANDER_PRINTING,
  HAS_CONTENTS,
  KEY_ART,
  LIST_PRICE,
  MSRP,
  PHOTO_IDS,
  PRICE_JOINS,
} from "./store-sql";

// Read models for the store screens (ADR 0006). Prices follow design doc 06, rule 1 (a product's
// own override, else its official MSRP, else its kind's price; no price means not for sale),
// raised to what the contents sell back for (design doc 27, ADR 0021).

/** What a product's packaging should show, and what WPN says about it. */
export type ProductPresentation = Readonly<{
  /** Downloaded official photos (artwork image ids); empty means generated art. */
  photoIds: readonly string[];
  /** A card to feature in generated art: the deck's commander, or null for the set's own. */
  featured: FeaturedArt | null;
  /** From WPN: plain text, or null. */
  description: string | null;
  contents: ReadonlyArray<{ depth: number; text: string }>;
  /** From WPN, e.g. "2026-10-02", or null. */
  releaseDate: string | null;
}>;

/** A card whose art decorates a set's products: its most valuable rare or mythic. */
export type FeaturedArt = Readonly<{ printingId: string; artist: string | null }>;

export type StoreSet = Readonly<{
  code: string;
  name: string;
  keyruneCode: string;
  /** The main set's symbol, for a Commander set whose own symbol Keyrune may not have yet. */
  parentKeyruneCode: string | null;
  releaseDate: string;
  productsForSale: number;
  featured: FeaturedArt | null;
  /** The set's official key art, as an artwork image id, once downloaded. */
  keyArtId: string | null;
}>;

/** The most valuable rare or mythic with an image, per set, on the newest price day. */
export async function featuredArt(db: DbExecutor, setCodes: readonly string[]) {
  if (setCodes.length === 0) return new Map<string, FeaturedArt>();
  const rows = await db.execute<{
    set_code: string;
    printing_id: string;
    artist: string | null;
  }>(sql`
    select distinct on (p.set_code) p.set_code, p.id as printing_id, p.artist
      from printings p
      join ${newestDayPrices()} s on s.printing_id = p.id
     where p.set_code = any(${sql.param([...setCodes])}::text[])
       and p.image_uris is not null
       and p.rarity in ('rare', 'mythic')
     order by p.set_code, s.usd_cents desc, p.id
  `);
  return new Map(
    rows.rows.map((row) => [row.set_code, { printingId: row.printing_id, artist: row.artist }]),
  );
}

/** Enabled sets with at least one product for sale, newest first. */
async function storeSets(db: DbExecutor, query?: string): Promise<StoreSet[]> {
  const trimmed = (query ?? "").trim();
  const pattern = `%${trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const filter =
    trimmed === ""
      ? sql``
      : sql`and (s.name ilike ${pattern} escape '\\' or s.code ilike ${pattern} escape '\\')`;
  const rows = await db.execute<{
    code: string;
    name: string;
    keyrune_code: string;
    release_date: string;
    products_for_sale: number;
    key_art_id: string | null;
    parent_keyrune_code: string | null;
  }>(sql`
    select s.code, s.name, s.keyrune_code, s.release_date, count(*)::int as products_for_sale,
           ${KEY_ART} as key_art_id, (select p.keyrune_code from card_sets p where p.code = s.parent_code) as parent_keyrune_code
      from card_sets s
      join sealed_products sp on sp.set_code = s.code
      ${PRICE_JOINS}
     where s.is_enabled and ${MSRP} is not null and ${HAS_CONTENTS}
       ${filter}
     group by s.code
     order by s.release_date desc, s.code
  `);
  const featured = await featuredArt(
    db,
    rows.rows.map((row) => row.code),
  );
  return rows.rows.map((row) => ({
    code: row.code,
    name: row.name,
    keyruneCode: row.keyrune_code,
    parentKeyruneCode: row.parent_keyrune_code,
    releaseDate: row.release_date,
    productsForSale: row.products_for_sale,
    featured: featured.get(row.code) ?? null,
    keyArtId: row.key_art_id,
  }));
}

export type ProductForSale = Readonly<{
  id: string;
  name: string;
  category: string;
  subtype: string | null;
  /** The store price: the MSRP, or more when the contents sell back for more (design doc 27). */
  msrp: Cents;
  /** The price before the resale floor; less than `msrp` when the floor raised it. */
  listPrice: Cents;
}> &
  ProductPresentation;

export type StorePage = Readonly<{
  set: Omit<StoreSet, "productsForSale">;
  products: ProductForSale[];
}>;

/** One enabled set's products for sale, cheapest first within each category. */
export async function page(db: DbExecutor, code: string): Promise<StorePage | null> {
  const [set] = (
    await db.execute<{
      code: string;
      name: string;
      keyrune_code: string;
      release_date: string;
      key_art_id: string | null;
      parent_keyrune_code: string | null;
    }>(sql`
      select s.code, s.name, s.keyrune_code, s.release_date, ${KEY_ART} as key_art_id,
             (select p.keyrune_code from card_sets p where p.code = s.parent_code) as parent_keyrune_code
        from card_sets s where s.code = ${code.toUpperCase()} and s.is_enabled
    `)
  ).rows;
  if (set === undefined) return null;

  const rows = await db.execute<{
    id: string;
    name: string;
    category: string;
    subtype: string | null;
    msrp: number;
    list_price: number;
    photo_ids: string[];
    commander_printing_id: string | null;
    commander_artist: string | null;
    description: string | null;
    contents: Array<{ depth: number; text: string }> | null;
    wpn_release_date: string | null;
  }>(sql`
    select sp.id, sp.name, sp.category, sp.subtype, ${MSRP} as msrp,
           ${LIST_PRICE} as list_price, ${PHOTO_IDS} as photo_ids,
           cp.id as commander_printing_id, cp.artist as commander_artist,
           w.description, w.contents, w.release_date as wpn_release_date
      from sealed_products sp
      ${PRICE_JOINS}
      left join printings cp on cp.id = ${COMMANDER_PRINTING} and cp.image_uris is not null
     where sp.set_code = ${set.code} and ${MSRP} is not null and ${HAS_CONTENTS}
     order by sp.category, ${MSRP}, sp.name
  `);
  const featured = await featuredArt(db, [set.code]);
  return {
    set: {
      code: set.code,
      name: set.name,
      keyruneCode: set.keyrune_code,
      parentKeyruneCode: set.parent_keyrune_code,
      releaseDate: set.release_date,
      featured: featured.get(set.code) ?? null,
      keyArtId: set.key_art_id,
    },
    products: rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      subtype: row.subtype,
      msrp: Cents.of(Number(row.msrp)),
      listPrice: Cents.of(Number(row.list_price)),
      photoIds: row.photo_ids,
      featured:
        row.commander_printing_id === null
          ? null
          : { printingId: row.commander_printing_id, artist: row.commander_artist },
      description: row.description,
      contents: row.contents ?? [],
      releaseDate: row.wpn_release_date,
    })),
  };
}

export type StoreSearchProduct = ProductForSale &
  Readonly<{
    setCode: string;
    setName: string;
    keyruneCode: string;
    parentKeyruneCode: string | null;
    setFeatured: FeaturedArt | null;
  }>;

export type StoreSearchResult = Readonly<{
  sets: StoreSet[];
  products: StoreSearchProduct[];
  categories: readonly string[];
}>;

/**
 * Search the store across enabled sets and products for sale (by set, deck, sealed product,
 * category, description, or commander name).
 */
export async function search(
  db: DbExecutor,
  input: { query?: string; category?: string },
): Promise<StoreSearchResult> {
  const trimmed = (input.query ?? "").trim();
  const category = (input.category ?? "").trim();

  const categoryRows = await db.execute<{ category: string }>(sql`
    select distinct sp.category
      from sealed_products sp
      join card_sets s on s.code = sp.set_code
      ${PRICE_JOINS}
     where s.is_enabled and ${MSRP} is not null and ${HAS_CONTENTS}
     order by sp.category
  `);
  const categories = categoryRows.rows.map((row) => row.category);

  if (trimmed === "" && category === "") {
    return { sets: await storeSets(db), products: [], categories };
  }

  const pattern = `%${trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const categoryFilter = category === "" ? sql`` : sql`and sp.category = ${category}`;
  const queryFilter =
    trimmed === ""
      ? sql``
      : sql`and (
          sp.name ilike ${pattern} escape '\\'
          or sp.category ilike ${pattern} escape '\\'
          or coalesce(sp.subtype, '') ilike ${pattern} escape '\\'
          or s.name ilike ${pattern} escape '\\'
          or s.code ilike ${pattern} escape '\\'
          or coalesce(w.description, '') ilike ${pattern} escape '\\'
          or coalesce(cp.name, '') ilike ${pattern} escape '\\'
        )`;

  const [sets, productRows] = await Promise.all([
    category === "" ? storeSets(db, trimmed) : Promise.resolve([]),
    db.execute<{
      id: string;
      name: string;
      category: string;
      subtype: string | null;
      msrp: number;
      list_price: number;
      photo_ids: string[];
      commander_printing_id: string | null;
      commander_artist: string | null;
      description: string | null;
      contents: Array<{ depth: number; text: string }> | null;
      wpn_release_date: string | null;
      set_code: string;
      set_name: string;
      keyrune_code: string;
      parent_keyrune_code: string | null;
    }>(sql`
      select sp.id, sp.name, sp.category, sp.subtype, ${MSRP} as msrp,
             ${LIST_PRICE} as list_price, ${PHOTO_IDS} as photo_ids,
             cp.id as commander_printing_id, cp.artist as commander_artist,
             w.description, w.contents, w.release_date as wpn_release_date,
             s.code as set_code, s.name as set_name, s.keyrune_code,
             (select p.keyrune_code from card_sets p where p.code = s.parent_code) as parent_keyrune_code
        from sealed_products sp
        join card_sets s on s.code = sp.set_code
        ${PRICE_JOINS}
        left join printings cp on cp.id = ${COMMANDER_PRINTING} and cp.image_uris is not null
       where s.is_enabled and ${MSRP} is not null and ${HAS_CONTENTS}
         ${categoryFilter}
         ${queryFilter}
       order by s.release_date desc, sp.category, ${MSRP}, sp.name
       limit 60
    `),
  ]);

  const setCodes = [...new Set(productRows.rows.map((row) => row.set_code))];
  const featured = await featuredArt(db, setCodes);

  return {
    sets,
    categories,
    products: productRows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      subtype: row.subtype,
      msrp: Cents.of(Number(row.msrp)),
      listPrice: Cents.of(Number(row.list_price)),
      photoIds: row.photo_ids,
      featured:
        row.commander_printing_id === null
          ? null
          : { printingId: row.commander_printing_id, artist: row.commander_artist },
      description: row.description,
      contents: row.contents ?? [],
      releaseDate: row.wpn_release_date,
      setCode: row.set_code,
      setName: row.set_name,
      keyruneCode: row.keyrune_code,
      parentKeyruneCode: row.parent_keyrune_code,
      setFeatured: featured.get(row.set_code) ?? null,
    })),
  };
}
