import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cents, err, ok } from "@/shared/kernel";
import { checkRate, payoutPerCopy } from "./singles";

describe("payoutPerCopy (rule 4)", () => {
  it("pays the rate's share of market price, rounded down", () => {
    expect(payoutPerCopy(Cents.of(199), 5000)).toBe(99); // $0.995 → $0.99
    expect(payoutPerCopy(Cents.of(1234), 10_000)).toBe(1234);
  });

  it("pays at least 1¢ for a card with a price, and nothing at $0.00 or a 0% rate", () => {
    expect(payoutPerCopy(Cents.of(1), 5000)).toBe(1); // half a cent becomes the 1¢ minimum
    expect(payoutPerCopy(Cents.of(0), 5000)).toBe(0);
    expect(payoutPerCopy(Cents.of(250), 0)).toBe(0);
  });

  it("never pays more than the market price; above the minimum, it's the exact share rounded down", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (market, rate) => {
          const payout = payoutPerCopy(Cents.of(market), rate);
          expect(payout).toBeLessThanOrEqual(market);
          if (payout > 1) {
            expect(payout * 10_000).toBeLessThanOrEqual(market * rate);
            expect((payout + 1) * 10_000).toBeGreaterThan(market * rate); // the largest such cent
          }
        },
      ),
    );
  });
});

describe("checkRate (rule 5)", () => {
  it("accepts 0% to 100% in whole basis points", () => {
    expect(checkRate(0)).toEqual(ok(0));
    expect(checkRate(10_000)).toEqual(ok(10_000));
    for (const bad of [-1, 10_001, 50.5])
      expect(checkRate(bad)).toEqual(err({ kind: "RateInvalid" }));
  });
});
