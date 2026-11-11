import { Cents, err, ok, type Result } from "@/shared/kernel";
import type { PriceInvalid, QuantityInvalid } from "./errors";
import { FULL_RATE_BPS } from "./singles";

// Sealed product prices (ADR 0014; design doc 06, rules 1, 4 and 8).

/** A product's kind, the key MSRPs are set by: "booster_box/play", "bundle/default". */
export function productKind(category: string, subtype: string | null): string {
  return `${category}/${subtype ?? "default"}`;
}

/**
 * Whether a product may sell at its kind's price. Several-in-one products never do: MTGJSON files
 * some cases, displays and sets under a single product's kind (a "Collector Booster Box Master
 * Case" is a `booster_box`, an "Intro Pack Display" a `deck/intro`, a "Welcome Deck Set of 5" a
 * `deck/welcome`), so the kind's price would sell several for the price of one. They sell only at
 * their official MSRP or an admin's own price. The SQL in store queries mirrors this
 * (`IS_MULTIPLE`).
 */
export function kindPriceApplies(productName: string): boolean {
  return !/\b(case|display|set of \d+)\b/i.test(productName);
}

/**
 * A product's list price (ADR 0014, amended by ADR 0015): its own override, else Wizards'
 * official MSRP from WPN, else its kind's price. None of them means not for sale.
 */
export function msrpFor(prices: {
  override: Cents | null;
  officialMsrp: Cents | null;
  kindPrice: Cents | null;
}): Cents | null {
  return prices.override ?? prices.officialMsrp ?? prices.kindPrice;
}

/**
 * The lowest price a product may sell at (ADR 0021): what its contents sell back for on
 * average, rounded up to the cent, so buying and selling everything back never pays.
 */
export function resaleFloor(contentsValue: Cents, buylistRateBps: number): Cents {
  return Cents.of(Math.ceil((contentsValue * buylistRateBps) / FULL_RATE_BPS));
}

/**
 * How the store prices sealed product (design doc 33, ADR 0024). `msrp`, the default: an
 * official MSRP sells as published, and only kind prices are raised to the resale floor.
 * `value`: official MSRPs are raised too (design doc 27's full rule).
 */
export const PRICING_MODES = ["msrp", "value"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export type StorePrice = Readonly<{
  /** What the store charges. */
  price: Cents;
  /** The price before the floor: override, official MSRP or kind price. */
  listPrice: Cents;
  /** The floor raised the price above the list price. */
  isRaised: boolean;
}>;

export type PriceInputs = Readonly<{
  override: Cents | null;
  officialMsrp: Cents | null;
  kindPrice: Cents | null;
  /** The contents' average market value from the last valuation, or null if not valued yet. */
  contentsValue: Cents | null;
  buylistRateBps: number;
  pricingMode: PricingMode;
}>;

/**
 * What a sealed product sells for (design doc 27, rules 1–3; design doc 33), or null when it
 * isn't for sale. An admin's override is used as typed (decision 2). In MSRP pricing, an official
 * MSRP sells as published. Otherwise the list price is raised to the resale floor when it's
 * below it. A product priced only by its kind isn't for sale until it
 * has been valued (decision 3). The store's SQL (`STORE_PRICE` in queries/store.ts) is the same
 * rule; an integration test checks they agree.
 */
export function storePrice(inputs: PriceInputs): StorePrice | null {
  const { override, officialMsrp, kindPrice, contentsValue, buylistRateBps, pricingMode } = inputs;
  if (override !== null) return { price: override, listPrice: override, isRaised: false };
  const listPrice = officialMsrp ?? kindPrice;
  if (listPrice === null) return null;
  // MSRP pricing sells an official MSRP as published (design doc 33, invariant 1).
  if (officialMsrp !== null && pricingMode === "msrp") {
    return { price: officialMsrp, listPrice, isRaised: false };
  }
  if (officialMsrp === null && contentsValue === null) return null;
  const floor = contentsValue === null ? Cents.zero : resaleFloor(contentsValue, buylistRateBps);
  return floor > listPrice
    ? { price: floor, listPrice, isRaised: true }
    : { price: listPrice, listPrice, isRaised: false };
}

export const MAX_PRICE = Cents.of(1_000_000); // $10,000.00
export const MAX_QUANTITY = 24;

/** A price an admin typed: at least $0.01 and at most $10,000 (rule 8). */
export function checkPrice(price: Cents): Result<Cents, PriceInvalid> {
  if (price <= 0) return err({ kind: "PriceInvalid", reason: "must be at least $0.01" });
  if (price > MAX_PRICE) {
    return err({ kind: "PriceInvalid", reason: `must be at most ${Cents.format(MAX_PRICE)}` });
  }
  return ok(price);
}

/** How many to buy at once: 1 to 24 (rule 4). */
export function checkQuantity(quantity: number): Result<number, QuantityInvalid> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return err({ kind: "QuantityInvalid", max: MAX_QUANTITY });
  }
  return ok(quantity);
}

/** Price × quantity, in whole cents. */
export function totalPrice(unitPrice: Cents, quantity: number): Cents {
  return Cents.of(unitPrice * quantity);
}
