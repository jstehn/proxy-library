import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import { checkDetails, fits, sameTarget, type WishTarget } from "./wish";

// A wish's own rules (design doc 26, section 4).

const ANY: WishTarget = { kind: "anyPrinting", oracleId: "cleaver", finish: "nonfoil" };
const EXACT: WishTarget = {
  kind: "exactPrinting",
  oracleId: "cleaver",
  printingId: "m3c-217",
  finish: "foil",
};

describe("checkDetails (rule 3)", () => {
  it("accepts 1 to 99 copies, an optional target and a short note (trimmed)", () => {
    expect(
      checkDetails({ quantity: 4, targetPrice: Cents.of(2000), note: "  for Lorehold " }),
    ).toEqual({
      ok: true,
      value: { quantity: 4, targetPrice: 2000, note: "for Lorehold" },
    });
  });

  it.each([
    [{ quantity: 0, targetPrice: null, note: "" }, "Want 1 to 99 copies."],
    [{ quantity: 100, targetPrice: null, note: "" }, "Want 1 to 99 copies."],
    [{ quantity: 1.5, targetPrice: null, note: "" }, "Want 1 to 99 copies."],
    [
      { quantity: 1, targetPrice: Cents.of(0), note: "" },
      "A target price must be $0.01 to $100,000.",
    ],
    [{ quantity: 1, targetPrice: null, note: "x".repeat(201) }, "A note can be 200 characters."],
  ])("refuses %o", (details, reason) => {
    expect(checkDetails(details)).toEqual({ ok: false, error: { kind: "InvalidWish", reason } });
  });
});

describe("sameTarget (rule 1)", () => {
  it("is the same card and finish preference, or the same printing and finish", () => {
    expect(sameTarget(ANY, { ...ANY })).toBe(true);
    expect(sameTarget(ANY, { ...ANY, finish: "foil" })).toBe(false);
    expect(sameTarget(EXACT, { ...EXACT })).toBe(true);
    expect(sameTarget(EXACT, { ...EXACT, finish: "nonfoil" })).toBe(false);
    expect(sameTarget(ANY, EXACT)).toBe(false);
  });
});

describe("fits", () => {
  const copy = (
    printingId: string,
    finish: "nonfoil" | "foil" | "etched",
    oracleId = "cleaver",
  ) => ({
    oracleId,
    printingId,
    finish,
  });

  it("any printing: the same card in a finish the preference allows", () => {
    expect(fits(ANY, copy("dmc-8", "nonfoil"))).toBe(true);
    expect(fits(ANY, copy("dmc-8", "foil"))).toBe(false);
    expect(fits(ANY, copy("bolt", "nonfoil", "bolt"))).toBe(false);
    expect(fits({ ...ANY, finish: "foil" }, copy("dmc-8", "etched"))).toBe(true);
    expect(fits({ ...ANY, finish: "cheapest" }, copy("dmc-8", "foil"))).toBe(true);
  });

  it("exact printing: only that printing in that finish", () => {
    expect(fits(EXACT, copy("m3c-217", "foil"))).toBe(true);
    expect(fits(EXACT, copy("m3c-217", "nonfoil"))).toBe(false);
    expect(fits(EXACT, copy("dmc-8", "foil"))).toBe(false);
  });
});
