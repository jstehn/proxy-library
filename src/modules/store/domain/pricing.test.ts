import { describe, expect, it } from "vitest";
import { Cents, err, ok } from "@/shared/kernel";
import {
  checkPrice,
  checkQuantity,
  kindPriceApplies,
  msrpFor,
  productKind,
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

  it("never sells a case at its kind's price (several boxes for the price of one)", () => {
    expect(kindPriceApplies("Marvel Super Heroes Collector Booster Box Master Case")).toBe(false);
    expect(kindPriceApplies("Foundations Beginner Box Case")).toBe(false);
    expect(kindPriceApplies("Bloomburrow Play Booster Box")).toBe(true);
    expect(kindPriceApplies("Showcase Collector Booster")).toBe(true); // "case" inside a word
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
