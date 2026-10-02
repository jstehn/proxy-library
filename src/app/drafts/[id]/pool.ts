// Sorting your picks while you draft: by color, with a mana curve, the way players lay out their
// cards on the table. Pure, from what the card faces print.

export type FaceFacts = Readonly<{ manaCost: string | null; typeLine: string }>;

export type PoolColumn = "W" | "U" | "B" | "R" | "G" | "multicolor" | "colorless" | "land";

export const COLUMN_LABELS: Readonly<Record<PoolColumn, string>> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  multicolor: "Multicolor",
  colorless: "Colorless",
  land: "Lands",
};

const COLUMN_ORDER: readonly PoolColumn[] = [
  "W",
  "U",
  "B",
  "R",
  "G",
  "multicolor",
  "colorless",
  "land",
];

const symbolsOf = (manaCost: string | null) =>
  [...(manaCost ?? "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);

/** Which column a card goes in: lands, then by the colors its mana cost shows. */
export function columnOf(face: FaceFacts | undefined): PoolColumn {
  if (face === undefined) return "colorless";
  if (/\bLand\b/.test(face.typeLine)) return "land";
  const colors = new Set(
    symbolsOf(face.manaCost).flatMap((symbol) =>
      symbol.split("/").filter((part) => "WUBRG".includes(part)),
    ),
  );
  if (colors.size === 0) return "colorless";
  if (colors.size > 1) return "multicolor";
  return [...colors][0] as PoolColumn;
}

/** Mana value from a printed cost: numbers count as themselves, X as 0, any other symbol as 1. */
export function manaValueOf(manaCost: string | null): number {
  return symbolsOf(manaCost).reduce((total, symbol) => {
    if (/^\d+$/.test(symbol)) return total + Number(symbol);
    if (symbol === "X" || symbol === "Y") return total;
    return total + 1;
  }, 0);
}

/** The pool in columns (only the ones with cards), each sorted by mana value. */
export function poolColumns<Card>(
  cards: readonly Card[],
  faceOf: (card: Card) => FaceFacts | undefined,
): Array<{ column: PoolColumn; cards: Card[] }> {
  return COLUMN_ORDER.map((column) => ({
    column,
    cards: cards
      .filter((card) => columnOf(faceOf(card)) === column)
      .sort(
        (a, b) =>
          manaValueOf(faceOf(a)?.manaCost ?? null) - manaValueOf(faceOf(b)?.manaCost ?? null),
      ),
  })).filter((group) => group.cards.length > 0);
}

/** How many non-land cards cost 0–1, 2, 3, 4, 5 and 6 or more. */
export function curveOf<Card>(
  cards: readonly Card[],
  faceOf: (card: Card) => FaceFacts | undefined,
): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const card of cards) {
    const face = faceOf(card);
    if (face === undefined || /\bLand\b/.test(face.typeLine)) continue;
    const value = manaValueOf(face.manaCost);
    counts[Math.min(5, Math.max(0, value - 1))] += 1;
  }
  return counts;
}

/** Copies of the same card (by `keyOf`) as one line with a count, in first-seen order. */
export function stacksOf<Card>(
  cards: readonly Card[],
  keyOf: (card: Card) => string,
): Array<{ card: Card; count: number; all: Card[] }> {
  const stacks = new Map<string, { card: Card; count: number; all: Card[] }>();
  for (const card of cards) {
    const key = keyOf(card);
    const stack = stacks.get(key);
    if (stack === undefined) stacks.set(key, { card, count: 1, all: [card] });
    else {
      stack.count += 1;
      stack.all.push(card);
    }
  }
  return [...stacks.values()];
}
