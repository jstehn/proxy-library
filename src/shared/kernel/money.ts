import type { Brand } from "./brand";

/**
 * An integer amount of US cents. All money in the app is `Cents`: floats can't
 * represent most decimal amounts exactly (0.1 + 0.2 !== 0.3). Negative values are
 * valid (ledger debits).
 */
export type Cents = Brand<number, "Cents">;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

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
   * Parse a USD price string as Scryfall returns it ("12.34", "0.5") into cents, using
   * string arithmetic so no float is ever involved. Returns null when absent or malformed.
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

  /** 1234 -> "$12.34", -500 -> "-$5.00" */
  format(amount: Cents): string {
    return usd.format(amount / 100);
  },
};
