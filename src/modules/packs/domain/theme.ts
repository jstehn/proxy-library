import type { BoosterConfig } from "@/modules/catalog";

// Which theme a Jumpstart pack is (task 40). A real pack has a theme card on the front; here the
// theme comes from the recipe: MTGJSON gives each theme's card list its own fixed sheet, named
// after the theme ("aboveTheClouds2" is the second list of "Above the Clouds").

/** The parts of a recipe the theme needs. */
export type ThemeRecipe = Pick<BoosterConfig, "boosterType" | "variants" | "sheets">;

/** Words kept lowercase inside a theme name, as in "Above the Clouds". */
const SMALL_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to"]);

/** Theme names that splitting the sheet name can't spell (apostrophes and hyphens). */
const SPELLINGS: Readonly<Record<string, string>> = {
  miteY: "Mite-y",
  multiHeaded: "Multi-Headed",
  neErDoWells: "Ne'er-Do-Wells",
  spiderVerse: "Spider-Verse",
  urzas: "Urza's",
  webSlinging: "Web-Slinging",
};

/**
 * The theme of a Jumpstart pack opened from variant `variantIndex` ("Angels"), or null for any
 * other booster. The theme's list is the variant's largest fixed sheet: a set's Jumpstart pack
 * also has a small fixed sheet of foils and a random rare.
 */
export function packTheme(recipe: ThemeRecipe, variantIndex: number): string | null {
  if (recipe.boosterType !== "jumpstart") return null;
  const variant = recipe.variants.at(variantIndex);
  if (variant === undefined) return null;

  let themeSheet: string | null = null;
  for (const [sheetName, count] of Object.entries(variant.slots)) {
    if (recipe.sheets[sheetName]?.isFixed !== true) continue;
    if (themeSheet === null || count > variant.slots[themeSheet]) themeSheet = sheetName;
  }
  return themeSheet === null ? null : themeName(themeSheet);
}

/** "aboveTheClouds2" → "Above the Clouds", "agentsOfSHIELD" → "Agents of SHIELD". */
export function themeName(sheetName: string): string {
  const base = sheetName.replace(/\d+$/, "");
  const spelled = SPELLINGS[base];
  if (spelled !== undefined) return spelled;

  const words = base.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
