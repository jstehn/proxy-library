import { describe, expect, it } from "vitest";
import { isNotable } from "./events";

describe("isNotable", () => {
  it("is rare or better, or worth $5", () => {
    expect(isNotable({ rarity: "common", priceCents: 10 })).toBe(false);
    expect(isNotable({ rarity: "uncommon", priceCents: 499 })).toBe(false);
    expect(isNotable({ rarity: "uncommon", priceCents: 500 })).toBe(true);
    expect(isNotable({ rarity: "rare", priceCents: 5 })).toBe(true);
    expect(isNotable({ rarity: "mythic", priceCents: null })).toBe(true);
    expect(isNotable({ rarity: "special", priceCents: null })).toBe(true);
  });
});
