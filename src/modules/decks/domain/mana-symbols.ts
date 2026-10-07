// Mana symbols for playtest proxies (design doc 22, section 3.4): reading "{2}{W/U}" out of costs
// and rules text, and how the Mana font (github.com/andrewgioia/mana) draws each symbol. The
// glyphs and colours below are copied from Mana's own stylesheet (mana-font/css/mana.css), so a
// proxy's symbols look the way they do on Scryfall and other sites that use the font.

/** The five colours, in the order cards list them. */
export const MANA_COLORS = ["W", "U", "B", "R", "G"] as const;
export type ManaColor = (typeof MANA_COLORS)[number];

/** A piece of rules text: plain words, or one symbol such as "T" or "W/U" (without braces). */
export type TextRun = Readonly<{ kind: "text"; text: string } | { kind: "symbol"; symbol: string }>;

/** Rules text split into words and symbols: "{T}: Add {G}." → symbol T, ": Add ", symbol G, ".". */
export function splitSymbols(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let rest = text;
  for (let match = /\{([^{}]+)\}/.exec(rest); match !== null; match = /\{([^{}]+)\}/.exec(rest)) {
    if (match.index > 0) runs.push({ kind: "text", text: rest.slice(0, match.index) });
    runs.push({ kind: "symbol", symbol: match[1] ?? "" });
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest !== "") runs.push({ kind: "text", text: rest });
  return runs;
}

/** The symbols of a mana cost, in order: "{1}{G/W}{G/W}" → ["1", "G/W", "G/W"]. */
export function costSymbols(manaCost: string | null): string[] {
  return splitSymbols(manaCost ?? "").flatMap((run) => (run.kind === "symbol" ? [run.symbol] : []));
}

/** The colours a cost asks for: "{1}{G/W}" → G and W; "{2/U}" → U; "{C}" → none. */
export function colorsOfCost(manaCost: string | null): ManaColor[] {
  const parts = new Set(costSymbols(manaCost).flatMap((symbol) => symbol.split("/")));
  return MANA_COLORS.filter((color) => parts.has(color));
}

/** How Mana draws one symbol: a coloured circle with a glyph, or a circle split in two. */
export type SymbolArt =
  | Readonly<{
      kind: "single";
      /** The glyph's character in the Mana font. */
      glyph: string;
      /** Circle and glyph colours, as "#rrggbb". */
      background: string;
      foreground: string;
      /** Mana draws some glyphs (Phyrexian) a little larger than the rest. */
      scale: number;
    }>
  | Readonly<{
      kind: "split";
      /** Top-left half, then bottom-right half, as `.ms-cost.ms-wu` draws them. */
      glyphs: readonly [string, string];
      backgrounds: readonly [string, string];
      foreground: string;
      scale: number;
    }>;

// Glyph characters, from `.ms-*::before { content: "…" }` in mana.css.
const COLOR_GLYPHS: Record<string, string> = {
  W: "",
  U: "",
  B: "",
  R: "",
  G: "",
  C: "",
};
const PHYREXIAN_GLYPH = "";
const OTHER_GLYPHS: Record<string, string> = {
  X: "",
  Y: "",
  Z: "",
  "½": "",
  "∞": "",
  "100": "",
  "1000000": "",
  T: "",
  Q: "",
  E: "",
  S: "",
  PW: "",
  CHAOS: "",
  A: "",
  TK: "",
  L: "",
  D: "",
  P: PHYREXIAN_GLYPH,
  H: PHYREXIAN_GLYPH,
  // Half white and half red mana (Unhinged) print as the plain symbol.
  HW: COLOR_GLYPHS.W ?? "",
  HR: COLOR_GLYPHS.R ?? "",
};

/** `.ms-cost.ms-w` and friends: the circle behind a single symbol. */
const COST_BACKGROUNDS: Record<string, string> = {
  W: "#f0f2c0",
  U: "#b5cde3",
  B: "#aca29a",
  R: "#db8664",
  G: "#93b483",
};
const GENERIC_BACKGROUND = "#beb9b2";
/** `--ms-mana-*`: the two halves of a hybrid symbol. */
const SPLIT_BACKGROUNDS: Record<string, string> = {
  W: "#fdfbce",
  U: "#bcdaf7",
  B: "#a7999e",
  R: "#f19b79",
  G: "#9fcba6",
  C: "#d0c6bb",
  "2": "#d0c6bb",
};
const GLYPH_COLOR = "#111111";
/** `.ms-cost.ms-p::before { transform: scale(1.2) }` */
const PHYREXIAN_SCALE = 1.2;

/** The glyph for a number from 0 to 20 (Mana has one per number). */
function numberGlyph(symbol: string): string | null {
  if (!/^\d+$/.test(symbol)) return null;
  const value = Number(symbol);
  if (value <= 15) return String.fromCharCode(0xe605 + value);
  if (value <= 20) return String.fromCharCode(0xe62a + value - 16);
  return null;
}

function glyphFor(part: string): string | null {
  return COLOR_GLYPHS[part] ?? numberGlyph(part) ?? OTHER_GLYPHS[part] ?? null;
}

/** How to draw a symbol ("W", "2/U", "G/U/P", "T"), or null if the Mana font has no glyph for it. */
export function symbolArt(symbol: string): SymbolArt | null {
  const parts = symbol.toUpperCase().split("/");
  const phyrexian = parts.length > 1 && parts.at(-1) === "P";
  const halves = phyrexian ? parts.slice(0, -1) : parts;

  if (halves.length === 2) {
    const [first = "", second = ""] = halves;
    const glyphs = phyrexian
      ? ([PHYREXIAN_GLYPH, PHYREXIAN_GLYPH] as const)
      : ([glyphFor(first), glyphFor(second)] as const);
    const backgrounds = [SPLIT_BACKGROUNDS[first], SPLIT_BACKGROUNDS[second]] as const;
    if (glyphs[0] === null || glyphs[1] === null) return null;
    if (backgrounds[0] === undefined || backgrounds[1] === undefined) return null;
    return {
      kind: "split",
      glyphs: [glyphs[0], glyphs[1]],
      backgrounds: [backgrounds[0], backgrounds[1]],
      foreground: GLYPH_COLOR,
      scale: phyrexian ? PHYREXIAN_SCALE : 1,
    };
  }

  const [only = ""] = halves;
  const glyph = phyrexian ? PHYREXIAN_GLYPH : glyphFor(only);
  if (glyph === null || halves.length !== 1) return null;
  // The untap symbol is the one drawn light on dark (`.ms-cost.ms-untap`).
  if (only === "Q") {
    return { kind: "single", glyph, background: GLYPH_COLOR, foreground: "#ffffff", scale: 1 };
  }
  return {
    kind: "single",
    glyph,
    background: COST_BACKGROUNDS[only] ?? GENERIC_BACKGROUND,
    foreground: GLYPH_COLOR,
    scale: phyrexian || only === "P" || only === "H" ? PHYREXIAN_SCALE : 1,
  };
}
