import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cents, err, ok } from "@/shared/kernel";
import {
  checkPrice,
  checkQuantity,
  kindPriceApplies,
  msrpFor,
  PRICING_MODES,
  productKind,
  resaleFloor,
  storePrice,
  totalPrice,
} from "./pricing";

describe("pricing", () => {
  it("names a product's kind by category and subtype", () => {
    expect(productKind("booster_box", "play")).toBe("booster_box/play");
    expect(productKind("bundle", null)).toBe("bundle/default");
  });

  it("uses the product's own override, then Wizards' official MSRP, then its kind's price", () => {
    const five = Cents.of(500);
    const six = Cents.of(600);
    const seven = Cents.of(700);
    expect(msrpFor({ override: six, officialMsrp: seven, kindPrice: five })).toBe(six);
    expect(msrpFor({ override: null, officialMsrp: seven, kindPrice: five })).toBe(seven);
    expect(msrpFor({ override: null, officialMsrp: null, kindPrice: five })).toBe(five);
    expect(msrpFor({ override: null, officialMsrp: null, kindPrice: null })).toBeNull();
  });

  it("never sells a case, display or set at its kind's price (several for the price of one)", () => {
    expect(kindPriceApplies("Marvel Super Heroes Collector Booster Box Master Case")).toBe(false);
    expect(kindPriceApplies("Foundations Beginner Box Case")).toBe(false);
    expect(kindPriceApplies("Bloomburrow Play Booster Box")).toBe(true);
    expect(kindPriceApplies("Showcase Collector Booster")).toBe(true); // "case" inside a word
    expect(kindPriceApplies("Scars of Mirrodin Intro Pack Display")).toBe(false);
    expect(kindPriceApplies("Welcome Deck 2026 Set of 5")).toBe(false);
    expect(kindPriceApplies("Final Fantasy Scene Box Set of 4")).toBe(false);
    expect(kindPriceApplies("Welcome Deck 2026 White Deck")).toBe(true);
  });

  it("accepts prices from $0.01 to $10,000 (rule 8)", () => {
    expect(checkPrice(Cents.of(1))).toEqual(ok(1));
    expect(checkPrice(Cents.of(1_000_000))).toEqual(ok(1_000_000));
    expect(checkPrice(Cents.of(0)).ok).toBe(false);
    expect(checkPrice(Cents.of(1_000_001)).ok).toBe(false);
  });

  it("accepts 1 to 24 at a time (rule 4)", () => {
    expect(checkQuantity(1)).toEqual(ok(1));
    expect(checkQuantity(24)).toEqual(ok(24));
    for (const bad of [0, 25, 1.5, -1]) {
      expect(checkQuantity(bad)).toEqual(err({ kind: "QuantityInvalid", max: 24 }));
    }
  });

  it("multiplies in whole cents", () => {
    expect(totalPrice(Cents.of(549), 3)).toBe(1647);
  });
});

describe("storePrice in MSRP pricing, the default (design doc 33)", () => {
  const msrp = {
    override: null,
    officialMsrp: null,
    kindPrice: Cents.of(399),
    contentsValue: Cents.of(127_627),
    buylistRateBps: 5000,
    pricingMode: "msrp" as const,
  };

  it("sells an official MSRP as published, even when the contents sell back for more", () => {
    // The Chocobo Bundle: $109.99 on the box, cards that sell back for $174.62.
    const bundle = { ...msrp, officialMsrp: Cents.of(10_999), contentsValue: Cents.of(34_924) };
    expect(storePrice(bundle)).toEqual({ price: 10_999, listPrice: 10_999, isRaised: false });
    expect(storePrice({ ...bundle, pricingMode: "value" })?.price).toBe(17_462);
  });

  it("still raises a kind price, the generic guess, to the resale value", () => {
    expect(storePrice(msrp)).toEqual({ price: 63_814, listPrice: 399, isRaised: true });
  });
});

describe("storePrice (design doc 27, in value-based pricing)", () => {
  const cents = (value: number) => Cents.of(value);
  const base = {
    override: null,
    officialMsrp: null,
    kindPrice: cents(399),
    contentsValue: cents(127_627),
    buylistRateBps: 5000,
    pricingMode: "value" as const,
  };

  it("raises a pack whose contents sell back for more than it costs: Alpha's $3.99 to $638.14", () => {
    expect(storePrice(base)).toEqual({ price: 63_814, listPrice: 399, isRaised: true });
  });

  it("keeps the list price when the contents sell back for less", () => {
    expect(storePrice({ ...base, contentsValue: cents(700) })).toEqual({
      price: 399,
      listPrice: 399,
      isRaised: false,
    });
  });

  it("raises an official MSRP too, but never an admin's override (decision 2)", () => {
    expect(storePrice({ ...base, officialMsrp: cents(499) })?.price).toBe(63_814);
    expect(storePrice({ ...base, override: cents(100) })).toEqual({
      price: 100,
      listPrice: 100,
      isRaised: false,
    });
  });

  it("sells nothing priced only by its kind until it's been valued (decision 3)", () => {
    expect(storePrice({ ...base, contentsValue: null })).toBeNull();
    expect(storePrice({ ...base, contentsValue: null, officialMsrp: cents(499) })?.price).toBe(499);
  });

  it("never makes a product without a list price for sale", () => {
    expect(storePrice({ ...base, kindPrice: null })).toBeNull();
  });

  it("rounds the floor up, and has none when the store isn't buying (rule 5)", () => {
    expect(resaleFloor(cents(1001), 5000)).toBe(501);
    expect(storePrice({ ...base, buylistRateBps: 0 })?.price).toBe(399);
  });

  const money = fc.integer({ min: 1, max: 10_000_000 }).map(cents);
  const maybe = fc.option(money, { nil: null });
  const inputs = fc.record({
    override: maybe,
    officialMsrp: maybe,
    kindPrice: maybe,
    contentsValue: fc.option(fc.integer({ min: 0, max: 100_000_000 }).map(cents), { nil: null }),
    buylistRateBps: fc.integer({ min: 0, max: 10_000 }),
    pricingMode: fc.constantFrom(...PRICING_MODES),
  });

  it("never sells below the resale value without an override (rule 1; doc 33, invariant 2)", () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const result = storePrice(input);
        if (result === null || input.override !== null || input.contentsValue === null) return true;
        // MSRP pricing sells an official MSRP as published, below the floor or not.
        if (input.pricingMode === "msrp" && input.officialMsrp !== null) return true;
        return result.price * 10_000 >= input.contentsValue * input.buylistRateBps;
      }),
    );
  });

  it("in MSRP pricing, sells an official MSRP as published (design doc 33, invariant 1)", () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const result = storePrice({ ...input, pricingMode: "msrp" });
        if (input.override !== null || input.officialMsrp === null) return true;
        return result?.price === input.officialMsrp && !result.isRaised;
      }),
    );
  });

  it("never lowers a list price, and never creates one (rule 2)", () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const result = storePrice(input);
        const listPrice = msrpFor(input);
        if (listPrice === null) return result === null;
        return result === null || (result.price >= listPrice && result.listPrice === listPrice);
      }),
    );
  });
});
