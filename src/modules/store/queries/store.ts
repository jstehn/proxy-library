import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";

// Read models for the store screens (ADR 0006). Prices follow design doc 06, rule 1: a product's
// own override, else its kind's price; no price means not for sale.

/** The kind key of a sealed product row aliased "sp", in SQL (matches productKind()). */
const KIND = sql`sp.category || '/' || coalesce(sp.subtype, 'default')`;
/**
 * A product's MSRP in SQL: its override, else Wizards' official MSRP, else its kind's price
 * (null = not for sale). ADR 0014, amended by ADR 0015.
 */
const MSRP = sql`coalesce(o.cents, w.msrp_cents, k.cents)`;
/** Only listed products with something inside are for sale (design doc 06, rule 2; 11). */
const HAS_CONTENTS = sql`sp.is_listed and jsonb_array_length(sp.contents) > 0`;
/** A case never takes its kind's price (mirrors `kindPriceApplies` in domain/pricing.ts). */
const IS_CASE = sql`sp.name ~* '\\mcase\\M'`;
const PRICE_JOINS = sql`
  left join msrp_overrides o on o.product_id = sp.id
  left join msrp_prices k on k.kind = ${KIND} and not ${IS_CASE}
  left join product_wpn_links l on l.product_id = sp.id
  left join wpn_products w on w.set_code = l.wpn_set_code and w.name = l.wpn_name`;

/**
 * A set's key art (from WPN), once downloaded: an artwork image id, or null. A Commander
 * companion set has no WPN page of its own, so it shows its main set's.
 */
const KEY_ART = sql`(
  select pg.key_art->>'id' from wpn_pages pg
   where pg.set_code = case when s.type = 'commander' then coalesce(s.parent_code, s.code)
                            else s.code end
     and pg.key_art->>'id' in (select image_id from artwork_files)
)`;

/**
 * A product's photos (design doc 13): the downloaded WPN photos its link says to show, in order.
 * "variants" shows them all (one per owned item); "one" shows the admin's pick; "none", nothing.
 */
const PHOTO_IDS = sql`(
  select coalesce(jsonb_agg(image->>'id' order by position), '[]'::jsonb)
    from jsonb_array_elements(w.images) with ordinality as photos(image, position)
   where (l.photo = 'variants' or (l.photo = 'one' and position - 1 = l.photo_index))
     and image->>'id' in (select image_id from artwork_files)
)`;

/**
 * For a deck product, the first commander of its deck list, so its generated art can feature
 * that card (design doc 13, decision 1). Null for other products.
 */
const COMMANDER_PRINTING = sql`(
  select card->>'printingId'
    from jsonb_array_elements(sp.contents) as item
    join deck_lists d on d.set_code = item->>'setCode' and d.name = item->>'deckName'
    cross join jsonb_array_elements(d.cards) as card
   where item->>'kind' = 'deck' and card->>'board' = 'commander'
   limit 1
)`;

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
async function featuredArt(db: DbExecutor, setCodes: readonly string[]) {
  if (setCodes.length === 0) return new Map<string, FeaturedArt>();
  const rows = await db.execute<{
    set_code: string;
    printing_id: string;
    artist: string | null;
  }>(sql`
    select distinct on (p.set_code) p.set_code, p.id as printing_id, p.artist
      from printings p
      join price_snapshots s on s.printing_id = p.id
                            and s.day = (select max(day) from price_snapshots)
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
export async function storeSets(db: DbExecutor): Promise<StoreSet[]> {
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
  msrp: Cents;
}> &
  ProductPresentation;

export type StorePage = Readonly<{
  set: Omit<StoreSet, "productsForSale">;
  products: ProductForSale[];
}>;

/** One enabled set's products for sale, cheapest first within each category. */
export async function storePage(db: DbExecutor, code: string): Promise<StorePage | null> {
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
    photo_ids: string[];
    commander_printing_id: string | null;
    commander_artist: string | null;
    description: string | null;
    contents: Array<{ depth: number; text: string }> | null;
    wpn_release_date: string | null;
  }>(sql`
    select sp.id, sp.name, sp.category, sp.subtype, ${MSRP} as msrp,
           ${PHOTO_IDS} as photo_ids,
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

export type KindPriceRow = Readonly<{
  kind: string;
  price: Cents | null;
  products: number; // products of this kind in enabled sets
  example: string; // one product's name, to recognize the kind by
}>;

/** Every product kind in enabled sets, with its MSRP (or none), for the admin page. */
export async function kindPrices(db: DbExecutor): Promise<KindPriceRow[]> {
  const rows = await db.execute<{
    kind: string;
    cents: number | null;
    products: number;
    example: string;
  }>(sql`
    select ${KIND} as kind, k.cents, count(*)::int as products, min(sp.name) as example
      from sealed_products sp
      join card_sets s on s.code = sp.set_code and s.is_enabled
      left join msrp_prices k on k.kind = ${KIND}
     group by ${KIND}, k.cents
     order by k.cents is null, ${KIND}
  `);
  return rows.rows.map((row) => ({
    kind: row.kind,
    price: row.cents === null ? null : Cents.of(Number(row.cents)),
    products: row.products,
    example: row.example,
  }));
}

export type ProductPriceRow = Readonly<{
  id: string;
  setCode: string;
  name: string;
  kind: string;
  kindPrice: Cents | null;
  override: Cents | null;
  /** Wizards' official MSRP from WPN, if it lists one (ADR 0015). */
  officialMsrp: Cents | null;
}>;

/** Every product in one enabled set with its kind price and override, for the admin page. */
export async function productPrices(db: DbExecutor, setCode: string): Promise<ProductPriceRow[]> {
  const rows = await db.execute<{
    id: string;
    set_code: string;
    name: string;
    kind: string;
    kind_cents: number | null;
    override_cents: number | null;
    official_cents: number | null;
  }>(sql`
    select sp.id, sp.set_code, sp.name, ${KIND} as kind,
           k.cents as kind_cents, o.cents as override_cents, w.msrp_cents as official_cents
      from sealed_products sp
      join card_sets s on s.code = sp.set_code and s.is_enabled
      ${PRICE_JOINS}
     where sp.set_code = ${setCode.toUpperCase()}
     order by sp.category, sp.name
  `);
  const toCents = (value: number | null) => (value === null ? null : Cents.of(Number(value)));
  return rows.rows.map((row) => ({
    id: row.id,
    setCode: row.set_code,
    name: row.name,
    kind: row.kind,
    kindPrice: toCents(row.kind_cents),
    override: toCents(row.override_cents),
    officialMsrp: toCents(row.official_cents),
  }));
}

/**
 * The MSRP of a single booster pack of this set and type (for the Pack lab), or null. Looks for
 * a product whose whole contents are exactly that pack.
 */
export async function packMsrp(
  db: DbExecutor,
  setCode: string,
  boosterType: string,
): Promise<Cents | null> {
  const contents = JSON.stringify([{ kind: "pack", setCode, boosterType }]);
  const [row] = (
    await db.execute<{ msrp: number | null }>(sql`
      select ${MSRP} as msrp
        from sealed_products sp
        ${PRICE_JOINS}
       where sp.contents = ${contents}::jsonb and ${MSRP} is not null
       order by ${MSRP}
       limit 1
    `)
  ).rows;
  return row === undefined || row.msrp === null ? null : Cents.of(Number(row.msrp));
}

/**
 * The price of one pack of every booster sold as a single pack, keyed "SET/boosterType": the same
 * rule as `packMsrp`, in one query (a draft's entry fee is three packs, design doc 17).
 */
export async function packMsrps(db: DbExecutor): Promise<Map<string, Cents>> {
  const rows = await db.execute<{ set_code: string; booster_type: string; msrp: number }>(sql`
    select sp.contents->0->>'setCode' as set_code,
           sp.contents->0->>'boosterType' as booster_type,
           min(${MSRP}) as msrp
      from sealed_products sp
      ${PRICE_JOINS}
     where jsonb_array_length(sp.contents) = 1
       -- exactly one pack and nothing else, like packMsrp's whole-contents comparison
       and sp.contents->0 = jsonb_build_object('kind', 'pack',
                                               'setCode', sp.contents->0->>'setCode',
                                               'boosterType', sp.contents->0->>'boosterType')
       and ${MSRP} is not null
     group by 1, 2
  `);
  return new Map(
    rows.rows.map((row) => [`${row.set_code}/${row.booster_type}`, Cents.of(Number(row.msrp))]),
  );
}

export type SingleHistoryRow = Readonly<{
  id: number;
  direction: "buy" | "sell";
  finish: string;
  quantity: number;
  unitMarket: Cents;
  rateBps: number;
  unitPrice: Cents;
  total: Cents;
  priceDay: string | null;
  at: string;
}>;

/** A player's buys and sells of one printing, oldest first (ADR 0013). */
export async function singleHistory(
  db: DbExecutor,
  userId: string,
  printingId: string,
): Promise<SingleHistoryRow[]> {
  const rows = await db.execute<{
    id: number;
    direction: "buy" | "sell";
    finish: string;
    quantity: number;
    unit_market_cents: number;
    rate_bps: number;
    unit_price_cents: number;
    total_cents: number;
    price_day: string | null;
    created_at: Date;
  }>(sql`
    select id, direction, finish, quantity, unit_market_cents, rate_bps, unit_price_cents,
           total_cents, price_day::text as price_day, created_at
      from store_transactions
     where user_id = ${userId} and printing_id = ${printingId}
     order by created_at, id
  `);
  return rows.rows.map((row) => ({
    id: Number(row.id),
    direction: row.direction,
    finish: row.finish,
    quantity: row.quantity,
    unitMarket: Cents.of(Number(row.unit_market_cents)),
    rateBps: row.rate_bps,
    unitPrice: Cents.of(Number(row.unit_price_cents)),
    total: Cents.of(Number(row.total_cents)),
    priceDay: row.price_day,
    at: new Date(row.created_at).toISOString(),
  }));
}

/** The store's buylist rate, in basis points. */
export async function currentBuylistRate(db: DbExecutor): Promise<number> {
  const [row] = (
    await db.execute<{ rate: number }>(
      sql`select buylist_rate_bps as rate from store_settings where id = 1`,
    )
  ).rows;
  return row?.rate ?? 0;
}
