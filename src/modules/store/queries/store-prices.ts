import { sql } from "drizzle-orm";
import type { Actor, AdminActor } from "@/modules/accounts";
import { type DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import type { PricingMode } from "../domain/pricing";
import { HAS_CONTENTS, KIND, LIST_PRICE, MSRP, PRICE_JOINS, RESALE_FLOOR } from "./store-sql";

// Read models for the store screens (ADR 0006). Prices follow design doc 06, rule 1 (a product's
// own override, else its official MSRP, else its kind's price; no price means not for sale),
// raised to what the contents sell back for (design doc 27, ADR 0021).

export type KindPriceRow = Readonly<{
  kind: string;
  price: Cents | null;
  products: number; // products of this kind in enabled sets
  example: string; // one product's name, to recognize the kind by
}>;

/** Every product kind in enabled sets, with its MSRP (or none), for the admin page (kind A). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the AdminActor parameter is the access rule
export async function kindPrices(db: DbExecutor, admin: AdminActor): Promise<KindPriceRow[]> {
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
  /** The contents' average value from the last valuation, or null (design doc 27). */
  contentsValue: Cents | null;
  /** Some contents couldn't be valued and count as $0. */
  isPartial: boolean;
  /** What the store charges, or null when it isn't for sale. */
  storePrice: Cents | null;
  /** The resale floor raised the price above the list price. */
  isRaised: boolean;
}>;

/** Every product in one enabled set with its kind price and override, for the admin page (kind A). */
export async function productPrices(
  db: DbExecutor,
  admin: AdminActor,
  setCode: string,
): Promise<ProductPriceRow[]> {
  const rows = await db.execute<{
    id: string;
    set_code: string;
    name: string;
    kind: string;
    kind_cents: number | null;
    override_cents: number | null;
    official_cents: number | null;
    value_cents: number | null;
    is_partial: boolean | null;
    store_cents: number | null;
    list_cents: number | null;
  }>(sql`
    select sp.id, sp.set_code, sp.name, ${KIND} as kind,
           k.cents as kind_cents, o.cents as override_cents, w.msrp_cents as official_cents,
           v.value_cents, v.is_partial,
           case when ${HAS_CONTENTS} then ${MSRP} end as store_cents, ${LIST_PRICE} as list_cents
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
    contentsValue: toCents(row.value_cents),
    isPartial: row.is_partial ?? false,
    storePrice: toCents(row.store_cents),
    isRaised:
      row.store_cents !== null &&
      row.list_cents !== null &&
      Number(row.store_cents) > Number(row.list_cents),
  }));
}

export type PackPrice = Readonly<{ price: Cents; listPrice: Cents }>;

/**
 * The store price of a single booster pack of this set and type, and its list price before the
 * resale floor (for the Pack lab), or null. Looks for a product whose whole contents are
 * exactly that pack.
 */
export async function packPrice(
  db: DbExecutor,
  setCode: string,
  boosterType: string,
): Promise<PackPrice | null> {
  const contents = JSON.stringify([{ kind: "pack", setCode, boosterType }]);
  const [row] = (
    await db.execute<{ msrp: number; list_price: number }>(sql`
      select ${MSRP} as msrp, ${LIST_PRICE} as list_price
        from sealed_products sp
        ${PRICE_JOINS}
       where sp.contents = ${contents}::jsonb and ${MSRP} is not null
       order by ${MSRP}
       limit 1
    `)
  ).rows;
  return row === undefined
    ? null
    : { price: Cents.of(Number(row.msrp)), listPrice: Cents.of(Number(row.list_price)) };
}

/**
 * The price of one pack of every booster sold as a single pack, keyed "SET/boosterType": the same
 * rule as `packPrice`, in one query (a draft's entry fee is three packs, design doc 17).
 */
export async function packMsrps(db: DbExecutor): Promise<Map<string, Cents>> {
  const rows = await db.execute<{ set_code: string; booster_type: string; msrp: number }>(sql`
    select sp.contents->0->>'setCode' as set_code,
           sp.contents->0->>'boosterType' as booster_type,
           min(${MSRP}) as msrp
      from sealed_products sp
      ${PRICE_JOINS}
     where jsonb_array_length(sp.contents) = 1
       -- exactly one pack and nothing else, like packPrice's whole-contents comparison
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
  actor: Actor,
  printingId: string,
): Promise<SingleHistoryRow[]> {
  const userId = actor.userId;
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

/**
 * How many products for sale have a list price (official MSRP or kind price) below what their
 * contents sell back for: the products value-based pricing raises and MSRP pricing doesn't
 * (design doc 33). Kind A: the admin page only.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the AdminActor parameter is the access rule
export async function msrpsBelowResale(db: DbExecutor, admin: AdminActor): Promise<number> {
  const [row] = (
    await db.execute<{ count: number }>(sql`
      select count(*)::int as count
        from sealed_products sp
        join card_sets s on s.code = sp.set_code and s.is_enabled
        ${PRICE_JOINS}
       where ${HAS_CONTENTS} and o.cents is null and ${LIST_PRICE} is not null
         and ${RESALE_FLOOR} > ${LIST_PRICE}`)
  ).rows;
  return row?.count ?? 0;
}

/** How the store prices sealed product (design doc 33). */
export async function pricingMode(db: DbExecutor): Promise<PricingMode> {
  const [row] = (
    await db.execute<{ mode: string }>(
      sql`select pricing_mode as mode from store_settings where id = 1`,
    )
  ).rows;
  return row?.mode === "value" ? "value" : "msrp";
}

/** The store's buylist rate, in basis points. */
export async function buylistRate(db: DbExecutor): Promise<number> {
  const [row] = (
    await db.execute<{ rate: number }>(
      sql`select buylist_rate_bps as rate from store_settings where id = 1`,
    )
  ).rows;
  return row?.rate ?? 0;
}
