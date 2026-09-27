/**
 * Money helpers.
 *
 * All money in this app is an integer number of US cents. Floats can't
 * represent most decimal amounts exactly (0.1 + 0.2 !== 0.3), and a wallet
 * that drifts by fractions of a cent is a bug waiting to happen.
 */

/** An integer amount of US cents. A type alias: purely documentation for the compiler. */
export type Cents = number;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 1234 -> "$12.34" */
export function formatCents(cents: Cents): string {
  return usd.format(cents / 100);
}

/**
 * Parse a dollar price string as Scryfall returns it ("12.34", or null when
 * a card has no price for that finish) into cents.
 */
export function parseUsd(value: string | null | undefined): Cents | null {
  if (value == null || value.trim() === "") return null;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}
