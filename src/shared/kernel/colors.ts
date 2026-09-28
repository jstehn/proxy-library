// Magic's multicolored combinations and their community names (feedback 2026-09-28: filter and
// sort a collection by "Green-Blue (Simic)" rather than just "Multicolored").

export type ManaColor = "W" | "U" | "B" | "R" | "G";

export type ColorCombination = Readonly<{
  /** The value used in URLs and forms, e.g. "GU". */
  code: string;
  colors: readonly ManaColor[];
  /** The colors first, then the name: "Green-Blue (Simic)". */
  label: string;
}>;

const COLOR_NAMES: Readonly<Record<ManaColor, string>> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

function combination(code: string, name: string): ColorCombination {
  const colors = [...code] as ManaColor[];
  const colorNames = colors.map((color) => COLOR_NAMES[color]).join("-");
  return { code, colors, label: `${colorNames} (${name})` };
}

/** Every combination of two or more colors, in the order players usually list them. */
export const COLOR_COMBINATIONS: readonly ColorCombination[] = [
  // The ten two-color guilds of Ravnica: allied pairs, then enemy pairs.
  combination("WU", "Azorius"),
  combination("UB", "Dimir"),
  combination("BR", "Rakdos"),
  combination("RG", "Gruul"),
  combination("GW", "Selesnya"),
  combination("WB", "Orzhov"),
  combination("UR", "Izzet"),
  combination("BG", "Golgari"),
  combination("RW", "Boros"),
  combination("GU", "Simic"),
  // The shards of Alara (a color and its two allies), then the wedges of Tarkir.
  combination("GWU", "Bant"),
  combination("WUB", "Esper"),
  combination("UBR", "Grixis"),
  combination("BRG", "Jund"),
  combination("RGW", "Naya"),
  combination("WBG", "Abzan"),
  combination("URW", "Jeskai"),
  combination("BGU", "Sultai"),
  combination("RWB", "Mardu"),
  combination("GUR", "Temur"),
  // Four colors, named after the Nephilim of Guildpact.
  combination("WUBR", "Yore-Tiller"),
  combination("UBRG", "Glint-Eye"),
  combination("BRGW", "Dune-Brood"),
  combination("RGWU", "Ink-Treader"),
  combination("GWUB", "Witch-Maw"),
  combination("WUBRG", "Five-Color"),
];

/** The combination with exactly these colors, in any order ("UG" finds Simic), if any. */
export function colorCombination(code: string): ColorCombination | undefined {
  const wanted = [...code.toUpperCase()].sort().join("");
  return COLOR_COMBINATIONS.find((candidate) => [...candidate.colors].sort().join("") === wanted);
}
