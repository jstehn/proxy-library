// Commander Spellbook two-card combo domain types and bracket classifier (design doc 52, ADR 0025).

export type SpellbookTwoCardCombo = Readonly<{
  id: string;
  oracleIdA: string;
  oracleIdB: string;
  cardNameA: string;
  cardNameB: string;
  produces: readonly string[];
  bracketTag: string | null;
  manaValue: number | null;
  forcesBracket: 3 | 4;
}>;

/**
 * Maps Commander Spellbook's `bracketTag` and total mana cost to the lowest Commander bracket
 * that allows the two-card combo.
 *
 * Per Wizards' Commander Bracket rules, Brackets 1–2 disallow two-card infinite/game-winning
 * combos. Bracket 3 allows late-game two-card combos; Bracket 4+ allows any.
 * - `R` (Ruthless) → Bracket 4
 * - `S` (Spicy) / `P` (Powerful) / `C` (Casual) → Bracket 3
 * - Untagged fallback: total `manaValue <= 6` → Bracket 4, `>= 7` or unknown → Bracket 3.
 */
export function twoCardComboBracket(bracketTag: string | null, manaValue: number | null): 3 | 4 {
  const tag = bracketTag?.trim().toUpperCase() ?? null;
  if (tag === "R" || tag === "4" || tag === "5" || tag === "E") return 4;
  if (tag === "S" || tag === "P" || tag === "C" || tag === "3" || tag === "2" || tag === "1") {
    return 3;
  }
  if (manaValue !== null && manaValue <= 6) return 4;
  return 3;
}

/** Canonicalizes a pair of oracle IDs and card names so `oracleIdA <= oracleIdB`. */
export function canonicalComboPair(
  a: Readonly<{ oracleId: string; name: string }>,
  b: Readonly<{ oracleId: string; name: string }>,
): Readonly<{
  oracleIdA: string;
  oracleIdB: string;
  cardNameA: string;
  cardNameB: string;
}> {
  if (a.oracleId <= b.oracleId) {
    return { oracleIdA: a.oracleId, oracleIdB: b.oracleId, cardNameA: a.name, cardNameB: b.name };
  }
  return { oracleIdA: b.oracleId, oracleIdB: a.oracleId, cardNameA: b.name, cardNameB: a.name };
}
