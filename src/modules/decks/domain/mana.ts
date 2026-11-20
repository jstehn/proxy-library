// Shared mana cost parsing and pool arithmetic. Tap-for-mana is a card feature (design doc 66).
// Used across castability and deck-profile so mana rules live in one place.

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export type ManaPool = Record<ManaColor, number>;

export const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

export type ParsedManaCost = Readonly<{
  /** Strict single-color / colorless pips (e.g. {G}, {B}, {C}). */
  pips: ManaPool;
  /** Hybrid pip options (e.g. {U/B} -> ["U", "B"]). */
  hybridPips: ReadonlyArray<readonly ManaColor[]>;
  /** Phyrexian pips (e.g. {G/P} -> "G", payable with color or 2 life). */
  phyrexianPips: readonly ManaColor[];
  generic: number;
}>;

const COLOR_SET = new Set<string>(["W", "U", "B", "R", "G", "C"]);

/** Parse an MTG mana cost string like `{1}{U/B}{G/P}` into strict pips, hybrid options, Phyrexian pips, and generic mana. */
export function parseManaCost(manaCost: string | null | undefined, fallbackMv = 0): ParsedManaCost {
  if (!manaCost) {
    return {
      pips: { ...EMPTY_MANA_POOL },
      hybridPips: [],
      phyrexianPips: [],
      generic: Math.max(0, fallbackMv),
    };
  }
  const pips: ManaPool = { ...EMPTY_MANA_POOL };
  const hybridPips: ManaColor[][] = [];
  const phyrexianPips: ManaColor[] = [];
  let generic = 0;
  const symbols = manaCost.match(/\{([^}]+)\}/g) ?? [];
  for (const raw of symbols) {
    const sym = raw.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(sym)) {
      generic += Number(sym);
    } else if (COLOR_SET.has(sym)) {
      pips[sym as ManaColor] += 1;
    } else if (sym === "X" || sym === "Y" || sym === "Z") {
      // Variable costs default to 0 for base castability checks
    } else if (sym.includes("/")) {
      const parts = sym.split("/");
      if (parts.includes("P")) {
        const color = parts.find((p) => COLOR_SET.has(p)) as ManaColor | undefined;
        if (color) phyrexianPips.push(color);
        else generic += 1;
      } else if (/^\d+$/.test(parts[0]) && parts[1] && COLOR_SET.has(parts[1])) {
        // Two-brid (e.g. {2/B}): can be paid with color or generic
        hybridPips.push([parts[1] as ManaColor]);
      } else {
        const colors = parts.filter((p) => COLOR_SET.has(p)) as ManaColor[];
        if (colors.length >= 2) hybridPips.push(colors);
        else if (colors.length === 1) pips[colors[0]] += 1;
        else generic += 1;
      }
    }
  }
  return { pips, hybridPips, phyrexianPips, generic };
}

/** Minimum mana pips that cannot be reduced by generic cost reduction (CR 601.2f). */
export function countMinimumPips(manaCost: string | null | undefined): number {
  const parsed = parseManaCost(manaCost, 0);
  let total = parsed.hybridPips.length;
  for (const c of Object.values(parsed.pips)) total += c;
  return total;
}
