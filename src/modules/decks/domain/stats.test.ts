import { describe, expect, it } from "vitest";
import { deckStats, mainType } from "./stats";

describe("deckStats", () => {
  it("counts the curve without lands or the sideboard, 7+ together", () => {
    const stats = deckStats([
      { quantity: 4, manaValue: 1, typeLine: "Instant", board: "main" },
      { quantity: 2, manaValue: 9, typeLine: "Creature — Eldrazi", board: "main" },
      { quantity: 20, manaValue: 0, typeLine: "Basic Land — Mountain", board: "main" },
      { quantity: 3, manaValue: 2, typeLine: "Sorcery", board: "side" },
      { quantity: 1, manaValue: 3, typeLine: "Legendary Creature — Human", board: "commander" },
    ]);
    expect(stats.curve).toEqual([0, 4, 0, 1, 0, 0, 0, 2]);
    expect(stats.types).toEqual({ Instant: 4, Creature: 3, Land: 20 });
    expect(stats.averageManaValue).toBeCloseTo((4 * 1 + 2 * 9 + 3) / 7);
  });

  it("is all zeros for an empty deck", () => {
    expect(deckStats([])).toEqual({
      curve: [0, 0, 0, 0, 0, 0, 0, 0],
      types: {},
      averageManaValue: 0,
    });
  });
});

describe("mainType", () => {
  it("uses the first type in the usual order", () => {
    expect(mainType("Artifact Creature — Golem")).toBe("Creature");
    expect(mainType("Enchantment — Class")).toBe("Enchantment");
    expect(mainType("Artifact Land")).toBe("Artifact");
    expect(mainType("Kindred Tribal")).toBe("Other");
  });
});
