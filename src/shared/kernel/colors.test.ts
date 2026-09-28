import { describe, expect, it } from "vitest";
import { COLOR_COMBINATIONS, colorCombination } from "./colors";

describe("COLOR_COMBINATIONS", () => {
  it("has every combination of two or more colors exactly once", () => {
    // 10 pairs + 10 triples + 5 fours + 1 five = 26.
    expect(COLOR_COMBINATIONS).toHaveLength(26);
    const sortedCodes = COLOR_COMBINATIONS.map((entry) => [...entry.colors].sort().join(""));
    expect(new Set(sortedCodes).size).toBe(26);
  });

  it("labels each with its colors first, then its name", () => {
    expect(colorCombination("GU")?.label).toBe("Green-Blue (Simic)");
    expect(colorCombination("WUB")?.label).toBe("White-Blue-Black (Esper)");
  });
});

describe("colorCombination", () => {
  it("finds a combination whatever the order or case", () => {
    expect(colorCombination("ug")?.code).toBe("GU");
    expect(colorCombination("GBU")?.code).toBe("BGU"); // Sultai
  });

  it("finds nothing for one color or nonsense", () => {
    expect(colorCombination("G")).toBeUndefined();
    expect(colorCombination("M")).toBeUndefined();
    expect(colorCombination("")).toBeUndefined();
  });
});
