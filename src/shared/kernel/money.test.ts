import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cents } from "./money";

describe("Cents.of", () => {
  it("accepts integers, including negatives", () => {
    expect(Cents.of(1234)).toBe(1234);
    expect(Cents.of(-500)).toBe(-500);
  });

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects %s", (value) => {
    expect(() => Cents.of(value)).toThrow(RangeError);
  });
});

describe("Cents.fromUsd", () => {
  it.each([
    ["12.34", 1234],
    ["0.5", 50],
    ["0.05", 5],
    ["7", 700],
    [" 1.10 ", 110],
    ["0.29", 29], // 0.29 * 100 is 28.999999999999996 in floating point
    ["$12.50", 1250],
  ])("parses %j as %i cents", (input, expected) => {
    expect(Cents.fromUsd(input)).toBe(expected);
  });

  it.each([null, undefined, "", "abc", "-1.00", "1.234", "1,000.00", "1e3", "9999999999999.00"])(
    "returns null for %j",
    (input) => {
      expect(Cents.fromUsd(input)).toBeNull();
    },
  );

  it("round-trips any whole-cent amount written with two decimals", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (amount) => {
        const text = `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
        expect(Cents.fromUsd(text)).toBe(amount);
      }),
    );
  });
});

describe("arithmetic", () => {
  const cents = fc.integer({ min: -1_000_000, max: 1_000_000 }).map(Cents.of);

  it("add and subtract are inverses", () => {
    fc.assert(
      fc.property(cents, cents, (a, b) => {
        expect(Cents.subtract(Cents.add(a, b), b)).toBe(a);
      }),
    );
  });

  it("sum equals repeated add, and is zero for no values", () => {
    expect(Cents.sum([])).toBe(Cents.zero);
    fc.assert(
      fc.property(fc.array(cents), (values) => {
        expect(Cents.sum(values)).toBe(
          values.reduce((total, v) => Cents.add(total, v), Cents.zero),
        );
      }),
    );
  });

  it("negate flips the sign", () => {
    expect(Cents.negate(Cents.of(250))).toBe(-250);
  });
});

describe("Cents.format", () => {
  it("formats as US dollars", () => {
    expect(Cents.format(Cents.of(1234))).toBe("$12.34");
    expect(Cents.format(Cents.of(-500))).toBe("-$5.00");
    expect(Cents.format(Cents.zero)).toBe("$0.00");
  });
});

describe("Cents.applyRate", () => {
  it("takes a percentage in basis points, rounding down to the cent", () => {
    expect(Cents.applyRate(Cents.of(1000), 5000)).toBe(500); // 50% of $10.00
    expect(Cents.applyRate(Cents.of(999), 5000)).toBe(499); // $4.995 rounds DOWN to $4.99
    expect(Cents.applyRate(Cents.of(1), 9999)).toBe(0);
    expect(Cents.applyRate(Cents.of(1234), 10_000)).toBe(1234);
  });

  it("never pays more than the exact value, and never more than the amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (amount, rate) => {
          const result = Cents.applyRate(Cents.of(amount), rate);
          expect(result).toBeLessThanOrEqual((amount * rate) / 10_000);
          expect(result).toBeGreaterThan((amount * rate) / 10_000 - 1);
          expect(result).toBeLessThanOrEqual(amount);
        },
      ),
    );
  });

  it.each([-1, 10_001, 12.5])("rejects a rate of %s", (rate) => {
    expect(() => Cents.applyRate(Cents.of(100), rate)).toThrow(RangeError);
  });
});

describe("Cents.toPlainDollars", () => {
  it("writes an amount for a text field, and round-trips through fromUsd", () => {
    expect(Cents.toPlainDollars(Cents.of(2000))).toBe("20.00");
    expect(Cents.toPlainDollars(Cents.of(5))).toBe("0.05");
    expect(Cents.toPlainDollars(Cents.of(-1250))).toBe("-12.50");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (amount) => {
        expect(Cents.fromUsd(Cents.toPlainDollars(Cents.of(amount)))).toBe(amount);
      }),
    );
  });
});
