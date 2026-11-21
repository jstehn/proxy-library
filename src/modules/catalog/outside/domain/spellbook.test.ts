import { describe, expect, it } from "vitest";
import { canonicalComboPair, twoCardComboBracket } from "./spellbook";

describe("twoCardComboBracket", () => {
  it("maps Ruthless (R) to bracket 4 and Spicy/Powerful/Casual to bracket 3", () => {
    expect(twoCardComboBracket("R", 10)).toBe(4);
    expect(twoCardComboBracket("r", null)).toBe(4);
    expect(twoCardComboBracket("S", 3)).toBe(3);
    expect(twoCardComboBracket("P", 5)).toBe(3);
    expect(twoCardComboBracket("C", 4)).toBe(3);
  });

  it("falls back to mana value when bracketTag is null or unknown", () => {
    expect(twoCardComboBracket(null, 3)).toBe(4);
    expect(twoCardComboBracket(null, 6)).toBe(4);
    expect(twoCardComboBracket(null, 7)).toBe(3);
    expect(twoCardComboBracket(null, null)).toBe(3);
  });
});

describe("canonicalComboPair", () => {
  it("orders the pair deterministically by oracleId", () => {
    expect(
      canonicalComboPair(
        { oracleId: "zzz", name: "Thassa's Oracle" },
        { oracleId: "aaa", name: "Demonic Consultation" },
      ),
    ).toEqual({
      oracleIdA: "aaa",
      oracleIdB: "zzz",
      cardNameA: "Demonic Consultation",
      cardNameB: "Thassa's Oracle",
    });
  });
});
