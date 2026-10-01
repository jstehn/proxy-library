import { describe, expect, it } from "vitest";
import { colorPips, deckStats, isLand, mainType } from "./stats";

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
      creatureCurve: [0, 0, 0, 0, 0, 0, 0, 0],
      types: {},
      averageManaValue: 0,
      cardCount: 0,
      lands: 0,
      otherManaSources: 0,
      pips: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      sources: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      priceCents: 0,
    });
  });

  it("counts lands, mana sources, colors needed vs made, creatures and price", () => {
    const stats = deckStats([
      // 10 Plains and 2 Azorius dual lands.
      {
        quantity: 10,
        manaValue: 0,
        typeLine: "Basic Land — Plains",
        board: "main",
        producedMana: ["W"],
        priceCents: 5,
      },
      {
        quantity: 2,
        manaValue: 0,
        typeLine: "Land",
        board: "main",
        producedMana: ["W", "U"],
        priceCents: 100,
      },
      // An artifact land is a land.
      { quantity: 1, manaValue: 0, typeLine: "Artifact Land", board: "main", producedMana: ["U"] },
      // A mana rock is a source but not a land.
      {
        quantity: 1,
        manaValue: 1,
        typeLine: "Artifact",
        board: "main",
        manaCost: "{1}",
        producedMana: ["C"],
        priceCents: 150,
      },
      {
        quantity: 3,
        manaValue: 2,
        typeLine: "Creature — Bird",
        board: "main",
        manaCost: "{W}{U}",
        priceCents: 20,
      },
      { quantity: 2, manaValue: 3, typeLine: "Instant", board: "main", manaCost: "{1}{W/U}{W}" },
      {
        quantity: 4,
        manaValue: 1,
        typeLine: "Instant",
        board: "side",
        manaCost: "{U}",
        priceCents: 10,
      },
    ]);
    expect(stats.cardCount).toBe(19);
    expect(stats.lands).toBe(13);
    expect(stats.otherManaSources).toBe(1);
    expect(stats.curve).toEqual([0, 1, 3, 2, 0, 0, 0, 0]);
    expect(stats.creatureCurve).toEqual([0, 0, 3, 0, 0, 0, 0, 0]);
    // 3 × {W}{U} and 2 × {1}{W/U}{W}: W 3 + 4, U 3 + 2.
    expect(stats.pips).toEqual({ W: 7, U: 5, B: 0, R: 0, G: 0 });
    expect(stats.sources).toEqual({ W: 12, U: 3, B: 0, R: 0, G: 0, C: 1 });
    expect(stats.priceCents).toBe(10 * 5 + 2 * 100 + 150 + 3 * 20 + 4 * 10);
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

describe("isLand and colorPips", () => {
  it("treats a card's front face as what it is", () => {
    expect(isLand("Artifact Land")).toBe(true);
    expect(isLand("Instant // Land")).toBe(false);
    expect(isLand("Land // Creature — Elf")).toBe(true);
  });

  it("counts hybrid symbols toward both colors and Phyrexian toward theirs", () => {
    expect(colorPips("{2}{G}{G}")).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 2 });
    expect(colorPips("{R/W}{B/P}{C}")).toEqual({ W: 1, U: 0, B: 1, R: 1, G: 0 });
    expect(colorPips(null)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });
});
