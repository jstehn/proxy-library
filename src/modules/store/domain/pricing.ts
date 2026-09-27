import { Cents, err, ok, type Result } from "@/shared/kernel";
import type { PriceInvalid, QuantityInvalid } from "./errors";

// Sealed product prices (ADR 0014; design doc 06, rules 1, 4 and 8).

/** A product's kind, the key MSRPs are set by: "booster_box/play", "bundle/default". */
export function productKind(category: string, subtype: string | null): string {
  return `${category}/${subtype ?? "default"}`;
}

/** The MSRP a product sells for: its own override if it has one, else its kind's price. */
export function msrpFor(prices: { override: Cents | null; kindPrice: Cents | null }): Cents | null {
  return prices.override ?? prices.kindPrice;
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
