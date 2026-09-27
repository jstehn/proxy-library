import { Cents, err, ok, type Result } from "@/shared/kernel";
import type { RateInvalid } from "./errors";

// Buying and selling single cards (design doc 07, rules 4 and 5).

export const FULL_RATE_BPS = 10_000; // 100%: what buying pays
export const DEFAULT_BUYLIST_RATE_BPS = 5_000; // 50%

/**
 * What the store pays for one copy: the market price at the buylist rate, rounded DOWN to the
 * cent (the wallet's one rounding rule, `Cents.applyRate`).
 */
export function payoutPerCopy(market: Cents, rateBps: number): Cents {
  return Cents.applyRate(market, rateBps);
}

/** A buylist rate an admin typed: 0% to 100%, in whole basis points. */
export function checkRate(rateBps: number): Result<number, RateInvalid> {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > FULL_RATE_BPS) {
    return err({ kind: "RateInvalid" });
  }
  return ok(rateBps);
}
