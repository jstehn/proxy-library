import type { Brand } from "./brand";

/**
 * An integer amount of US cents. All money in the app is `Cents`: floats can't
 * represent most decimal amounts exactly (0.1 + 0.2 !== 0.3). Negative values are
 * valid (ledger debits).
 */
export type Cents = Brand<number, "Cents">;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD_PATTERN = /^\$?(\d+)(?:\.(\d{1,2}))?$/;
const BASIS_POINTS_PER_WHOLE = 10_000; // 10000 basis points = 100%

/** Companion object: construction and arithmetic for `Cents` (a value object without a class). */
export const Cents = {
  zero: 0 as Cents,

  /** Smart constructor. A non-integer here is a bug, not an expected failure, so it throws. */
  of(value: number): Cents {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Cents must be a safe integer, got ${value}`);
    }
    return value as Cents;
  },

  /**
   * Parse a dollar amount ("12.34", "0.5", "$12", as Scryfall returns it or a person types it)
   * into cents, using string arithmetic so no float is ever involved. Returns null when absent
   * or malformed.
   */
  fromUsd(value: string | null | undefined): Cents | null {
    if (value == null) return null;
    const match = USD_PATTERN.exec(value.trim());
    if (match === null) return null;
    const [, dollars, fraction = ""] = match;
    if (dollars.length > 12) return null; // beyond any real price; keeps us far from unsafe integers
    return Cents.of(Number(dollars) * 100 + Number(fraction.padEnd(2, "0")));
  },

  add(a: Cents, b: Cents): Cents {
    return Cents.of(a + b);
  },

  subtract(a: Cents, b: Cents): Cents {
    return Cents.of(a - b);
  },

  negate(a: Cents): Cents {
    return Cents.of(-a);
  },

  sum(values: Iterable<Cents>): Cents {
    let total = Cents.zero;
    for (const value of values) total = Cents.add(total, value);
    return total;
  },

  /**
   * A percentage of an amount, where the rate is in basis points (5000 = 50%). The result is
   * rounded DOWN to the whole cent, so nobody is ever paid more than the exact value.
   * This is the only place money is rounded (design doc 03, "Rounding rule").
   */
  applyRate(amount: Cents, rateBasisPoints: number): Cents {
    if (
      !Number.isInteger(rateBasisPoints) ||
      rateBasisPoints < 0 ||
      rateBasisPoints > BASIS_POINTS_PER_WHOLE
    ) {
      throw new RangeError(`rate must be 0–10000 basis points, got ${rateBasisPoints}`);
    }
    if (amount < 0) throw new RangeError(`applyRate needs a non-negative amount, got ${amount}`);
    return Cents.of(Math.floor((amount * rateBasisPoints) / BASIS_POINTS_PER_WHOLE));
  },

  /** 1234 -> "12.34", 5 -> "0.05" (no "$"): for putting an amount back into a text field. */
  toPlainDollars(amount: Cents): string {
    const sign = amount < 0 ? "-" : "";
    const absolute = Math.abs(amount);
    const dollars = Math.floor(absolute / 100);
    const cents = String(absolute % 100).padStart(2, "0");
    return `${sign}${dollars}.${cents}`;
  },

  /** 1234 -> "$12.34", -500 -> "-$5.00" */
  format(amount: Cents): string {
    return usd.format(amount / 100);
  },
};
