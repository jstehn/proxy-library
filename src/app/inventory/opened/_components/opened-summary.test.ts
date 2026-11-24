import { describe, expect, it } from "vitest";
import type { PrintingCard } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import {
  combineOpenedCards,
  sortOpenedCards,
  summarizePulls,
  type SerializedOpening,
} from "./opened-summary";

function card(
  id: string,
  name: string,
  rarity: string,
  priceCents: number,
  colors: string[] = ["R"],
  typeLine = "Creature",
): PrintingCard {
  return {
    id,
    name,
    collectorNumber: "1",
    rarity,
    variantLabel: "",
    finishes: ["nonfoil", "foil"],
    hasImage: true,
    hasBackImage: false,
    faces: [
      {
        name,
        manaCost: null,
        typeLine,
        text: "",
        power: null,
        toughness: null,
        loyalty: null,
        defense: null,
      },
    ],
    artist: null,
    setCode: "BLB",
    layout: "normal",
    colors,
    producedMana: [],
    prices: { nonfoil: Cents.of(priceCents), foil: Cents.of(priceCents * 2) },
  };
}

describe("opened-summary", () => {
  const bolt = card("p-bolt", "Lightning Bolt", "common", 150, ["R"]);
  const ring = card("p-ring", "The One Ring", "mythic", 8500, [], "Legendary Artifact");
  const forest = card("p-forest", "Forest", "common", 10, [], "Basic Land — Forest");
  const guide = card("p-guide", "Guide of Souls", "rare", 400, ["W"]);
  const cardsById = {
    [bolt.id]: bolt,
    [ring.id]: ring,
    [forest.id]: forest,
    [guide.id]: guide,
  };

  const openings: SerializedOpening[] = [
    {
      itemId: 1,
      name: "Pack 1",
      contentKind: "pack",
      theme: null,
      children: [],
      extras: [],
      cards: [
        { printingId: bolt.id, finish: "nonfoil", quantity: 1 },
        { printingId: forest.id, finish: "nonfoil", quantity: 1 },
        { printingId: guide.id, finish: "nonfoil", quantity: 1 },
      ],
    },
    {
      itemId: 2,
      name: "Pack 2",
      contentKind: "pack",
      theme: null,
      children: [],
      extras: [],
      cards: [
        { printingId: bolt.id, finish: "nonfoil", quantity: 1 },
        { printingId: bolt.id, finish: "foil", quantity: 1 },
        { printingId: ring.id, finish: "nonfoil", quantity: 1 },
      ],
    },
  ];

  it("stacks identical printing + finish pulls and keeps finishes separate", () => {
    const combined = combineOpenedCards(openings, cardsById, { "p-bolt/nonfoil": 5 });
    expect(combined).toHaveLength(5);

    const nonfoilBolt = combined.find((c) => c.key === "p-bolt/nonfoil");
    const foilBolt = combined.find((c) => c.key === "p-bolt/foil");
    expect(nonfoilBolt?.quantity).toBe(2);
    expect(nonfoilBolt?.totalPriceCents).toBe(300);
    expect(nonfoilBolt?.ownedTotal).toBe(5);
    expect(foilBolt?.quantity).toBe(1);
    expect(foilBolt?.unitPriceCents).toBe(300);
  });

  it("sorts by value, rarity, duplicates, color, and pack order", () => {
    const combined = combineOpenedCards(openings, cardsById);

    expect(sortOpenedCards(combined, "value").map((c) => c.key)).toEqual([
      "p-ring/nonfoil",
      "p-guide/nonfoil",
      "p-bolt/foil",
      "p-bolt/nonfoil",
      "p-forest/nonfoil",
    ]);

    expect(sortOpenedCards(combined, "duplicates")[0].key).toBe("p-bolt/nonfoil");

    expect(sortOpenedCards(combined, "color").map((c) => c.printing.name)).toEqual([
      "Guide of Souls", // W
      "Lightning Bolt", // R (foil, higher value)
      "Lightning Bolt", // R (nonfoil)
      "The One Ring", // colorless
      "Forest", // land
    ]);

    expect(sortOpenedCards(combined, "order").map((c) => c.key)).toEqual([
      "p-bolt/nonfoil",
      "p-forest/nonfoil",
      "p-guide/nonfoil",
      "p-bolt/foil",
      "p-ring/nonfoil",
    ]);
  });

  it("computes pull summary and highlights", () => {
    const combined = combineOpenedCards(openings, cardsById);
    const summary = summarizePulls(combined);
    expect(summary.totalCopies).toBe(6);
    expect(summary.uniqueStacks).toBe(5);
    expect(summary.duplicateCopies).toBe(1);
    expect(summary.totalCents).toBe(150 * 2 + 10 + 400 + 300 + 8500);
    expect(summary.highlights.map((h) => h.printing.name)).toEqual(["The One Ring"]);
  });
});
