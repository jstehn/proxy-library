import { describe, expect, it } from "vitest";
import { SAMPLE_BOOSTER, sampleSheet } from "../testing/recipes";
import { packTheme, themeName, type ThemeRecipe } from "./theme";

// Which theme a Jumpstart pack is (task 40).

const list = sampleSheet([["a", 1]], { isFixed: true });

/** Like Foundations Jumpstart: each variant is one theme's 20-card list. */
const JUMPSTART: ThemeRecipe = {
  boosterType: "jumpstart",
  variants: [
    { weight: 1, slots: { angels1: 20 } },
    { weight: 1, slots: { aboveTheClouds2: 20 } },
  ],
  sheets: { angels1: list, aboveTheClouds2: list },
};

/** Like Dominaria United's: a theme list, two fixed foils and a random rare. */
const SET_JUMPSTART: ThemeRecipe = {
  boosterType: "jumpstart",
  variants: [{ weight: 1, slots: { arcaneMischief: 17, arcaneMischiefFoils: 2, rareBlue: 1 } }],
  sheets: {
    arcaneMischief: list,
    arcaneMischiefFoils: list,
    rareBlue: sampleSheet([["b", 1]]),
  },
};

describe("packTheme", () => {
  it("names the theme of the list the pack came from", () => {
    expect(packTheme(JUMPSTART, 0)).toBe("Angels");
    expect(packTheme(JUMPSTART, 1)).toBe("Above the Clouds");
  });

  it("takes the theme list, not the foils, when a pack has more than one fixed sheet", () => {
    expect(packTheme(SET_JUMPSTART, 0)).toBe("Arcane Mischief");
  });

  it("has no theme for other boosters, or a variant that doesn't exist", () => {
    expect(packTheme(SAMPLE_BOOSTER, 0)).toBeNull();
    expect(packTheme(JUMPSTART, 5)).toBeNull();
  });
});

describe("themeName", () => {
  it("splits the words, keeps an acronym, and lowercases the small words", () => {
    expect(themeName("agentsOfSHIELD")).toBe("Agents of SHIELD");
    expect(themeName("goToSchool")).toBe("Go to School");
  });

  it("spells the few names with apostrophes or hyphens", () => {
    expect(themeName("neErDoWells1")).toBe("Ne'er-Do-Wells");
    expect(themeName("urzas")).toBe("Urza's");
  });
});
