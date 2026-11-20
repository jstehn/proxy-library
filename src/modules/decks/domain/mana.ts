// Shared mana cost parsing, pool arithmetic, and tap-mana production extraction.
// Used across goldfish-session, castability, and deck-profile so mana rules live in one place.

import { isLand, type CardFacts } from "@/shared/kernel";

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
const BASIC_LAND_MANA: Readonly<Record<string, ManaColor>> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

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

/** Deduct `cost` from `pool`, returning the remaining pool or `null` if insufficient. */
export function spendMana(
  pool: ManaPool,
  cost: ParsedManaCost,
  opts: Readonly<{ allowPhyrexianLife?: boolean }> = {},
): ManaPool | null {
  const allowPhyrexianLife = opts.allowPhyrexianLife ?? true;
  const next: ManaPool = { ...pool };
  const colors: ManaColor[] = ["W", "U", "B", "R", "G", "C"];
  for (const c of colors) {
    if (next[c] < cost.pips[c]) return null;
    next[c] -= cost.pips[c];
  }

  // Pay hybrid pips from whichever matching color currently has the highest surplus
  for (const options of cost.hybridPips) {
    const best = [...options].filter((c) => next[c] > 0).sort((a, b) => next[b] - next[a])[0];
    if (!best) return null;
    next[best] -= 1;
  }

  // Pay Phyrexian pips with mana if not paying life; otherwise pay life (0 mana)
  if (!allowPhyrexianLife) {
    for (const c of cost.phyrexianPips) {
      if (next[c] < 1) return null;
      next[c] -= 1;
    }
  }

  let rem = cost.generic;
  // Spend colorless first, then colored mana
  for (const c of ["C", "W", "U", "B", "R", "G"] as const) {
    if (rem <= 0) break;
    const take = Math.min(next[c], rem);
    next[c] -= take;
    rem -= take;
  }
  return rem === 0 ? next : null;
}

export function addMana(pool: ManaPool, delta: ManaPool): ManaPool {
  return {
    W: pool.W + delta.W,
    U: pool.U + delta.U,
    B: pool.B + delta.B,
    R: pool.R + delta.R,
    G: pool.G + delta.G,
    C: pool.C + delta.C,
  };
}

export type ManaSourceFacts = Pick<CardFacts, "typeLine"> &
  Partial<Pick<CardFacts, "text" | "producedMana">> &
  Readonly<{ isLand?: boolean }>;

/** Whether a card has an activated tap-mana ability or structured `producedMana`. */
export function hasTapManaAbility(card: Pick<ManaSourceFacts, "text" | "producedMana">): boolean {
  if ((card.producedMana?.length ?? 0) > 0) return true;
  return /\{T\}[^.]*Add\s+\{/.test(card.text ?? "");
}

/** Total mana count in a ManaPool. */
export function totalMana(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

/**
 * Extract the mana added when a permanent is tapped for its primary mana ability,
 * accounting for conditional lands (Temple of the False God, Urza's Tron, Shrine of the Forsaken Gods)
 * and mana-doubler statics (e.g. Forsaken Monument) when battlefield context is provided.
 */
export function extractTapManaProduction(
  card: ManaSourceFacts,
  battlefield?: ReadonlyArray<{ card: ManaSourceFacts }>,
): ManaPool {
  const added: ManaPool = { ...EMPTY_MANA_POOL };
  const text = card.text ?? "";
  const landCount = battlefield ? battlefield.filter((p) => isLand(p.card.typeLine)).length : 0;

  // Conditional: Temple of the False God ("Activate only if you control five or more lands")
  if (/activate only if you control five or more lands/i.test(text)) {
    if (!battlefield || landCount < 5) return added;
  }

  // Conditional: Urza's Mine / Power-Plant / Tower (Tron)
  if (/if you control an urza's/i.test(text) && battlefield) {
    const hasMine = battlefield.some((p) => /Urza's Mine/i.test(p.card.typeLine));
    const hasPlant = battlefield.some((p) => /Urza's Power-Plant/i.test(p.card.typeLine));
    const hasTower = battlefield.some((p) => /Urza's Tower/i.test(p.card.typeLine));
    if (hasMine && hasPlant && hasTower) {
      added.C += /add \{C\}\{C\}\{C\}/i.test(text) ? 3 : 2;
      return applyManaDoublers(added, battlefield);
    }
    added.C += 1;
    return applyManaDoublers(added, battlefield);
  }

  // Conditional: Shrine of the Forsaken Gods ("seven or more lands")
  if (/seven or more lands/i.test(text)) {
    added.C += battlefield && landCount >= 7 ? 2 : 1;
    return applyManaDoublers(added, battlefield);
  }

  // Standard explicit "{T}: Add {C}{C}" / "{T}: Add {B}{G}"
  const tapAddMatch = text.match(/\{T\}[^.]*Add\s+((?:\{[WUBRGC]\})+)/i);
  if (tapAddMatch) {
    const syms = tapAddMatch[1].match(/\{([WUBRGC])\}/gi) ?? [];
    for (const s of syms) {
      const c = s.slice(1, -1).toUpperCase() as ManaColor;
      added[c] += 1;
    }
    return applyManaDoublers(added, battlefield);
  }

  if (card.producedMana && card.producedMana.length > 0) {
    const first = card.producedMana[0].toUpperCase();
    if (COLOR_SET.has(first)) {
      added[first as ManaColor] += 1;
      return applyManaDoublers(added, battlefield);
    }
  }

  if (card.isLand) {
    for (const [subtype, color] of Object.entries(BASIC_LAND_MANA)) {
      if (card.typeLine.includes(subtype)) {
        added[color] += 1;
        return applyManaDoublers(added, battlefield);
      }
    }
    added.C += 1;
  }
  return applyManaDoublers(added, battlefield);
}

function applyManaDoublers(
  added: ManaPool,
  battlefield?: ReadonlyArray<{ card: ManaSourceFacts }>,
): ManaPool {
  if (!battlefield || added.C === 0) return added;
  const colorlessDoublers = battlefield.filter((p) =>
    /whenever you tap a permanent for \{C\}, add an additional \{C\}/i.test(p.card.text ?? ""),
  ).length;
  if (colorlessDoublers === 0) return added;
  return { ...added, C: added.C + colorlessDoublers };
}
