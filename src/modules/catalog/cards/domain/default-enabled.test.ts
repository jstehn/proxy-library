import { describe, expect, it } from "vitest";
import { isEnabledByDefault } from "./rules";

describe("isEnabledByDefault (rule 13)", () => {
  it("is true for expansions, core sets and Commander sets", () => {
    expect(isEnabledByDefault("expansion")).toBe(true); // Innistrad: Midnight Hunt
    expect(isEnabledByDefault("core")).toBe(true); // Foundations, Magic 2010
    expect(isEnabledByDefault("commander")).toBe(true); // Midnight Hunt Commander
  });

  it("is false for every other kind of set", () => {
    for (const type of ["promo", "token", "masters", "draft_innovation", "funny", "memorabilia"]) {
      expect(isEnabledByDefault(type)).toBe(false);
    }
  });
});
