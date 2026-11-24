import { describe, expect, it } from "vitest";
import { selectDuplicatesToSell, type DuplicateCandidateStack } from "./duplicates";

function stack(overrides: Partial<DuplicateCandidateStack> = {}): DuplicateCandidateStack {
  return {
    printingId: "p-1",
    finish: "nonfoil",
    quantity: 5,
    name: "Sol Ring",
    setCode: "BLC",
    collectorNumber: "1",
    rarity: "uncommon",
    marketCents: 200,
    ...overrides,
  };
}

describe("selectDuplicatesToSell", () => {
  it("keeps 1 copy by default and protects copies in decks when enabled", () => {
    const stacks = [
      stack({ printingId: "ring", name: "Sol Ring", quantity: 5, marketCents: 200 }),
      stack({ printingId: "bolt", name: "Lightning Bolt", quantity: 3, marketCents: 100 }),
    ];
    const decks = new Map([
      [
        "ring",
        [
          { name: "Squirrels", quantity: 1 },
          { name: "Bumbleflower", quantity: 1 },
        ],
      ],
    ]);

    const protectedResult = selectDuplicatesToSell(stacks, decks, 5000, {
      keep: 1,
      protectInDecks: true,
      keepFoils: false,
      maxLines: 500,
      maxQuantity: 999,
    });
    expect(protectedResult.items.map((item) => [item.printingId, item.quantity])).toEqual([
      ["ring", 3], // 5 owned - 2 in decks = 3 sellable
      ["bolt", 2], // 3 owned - 1 kept = 2 sellable
    ]);

    const unprotectedResult = selectDuplicatesToSell(stacks, decks, 5000, {
      keep: 1,
      protectInDecks: false,
      keepFoils: false,
      maxLines: 500,
      maxQuantity: 999,
    });
    expect(unprotectedResult.items[0].quantity).toBe(4);
  });

  it("respects keepFoils and counts skipped unpriced / zero-value stacks", () => {
    const stacks = [
      stack({ printingId: "foil-1", finish: "foil", quantity: 3, marketCents: 400 }),
      stack({ printingId: "no-price", quantity: 4, marketCents: null }),
      stack({ printingId: "zero", quantity: 4, marketCents: 0 }),
    ];

    const result = selectDuplicatesToSell(stacks, new Map(), 5000, {
      keep: 1,
      protectInDecks: true,
      keepFoils: true,
      maxLines: 500,
      maxQuantity: 999,
    });

    expect(result.items).toEqual([]);
    expect(result.skippedUnpriced).toBe(2);
  });
});
