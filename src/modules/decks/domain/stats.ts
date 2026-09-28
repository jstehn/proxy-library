// Deck statistics for the builder: the mana curve, card types and average mana value (lesson 09,
// exercise 5 became this). Pure: lines in, numbers out.

export type StatsLine = Readonly<{
  quantity: number;
  manaValue: number;
  typeLine: string;
  board: "main" | "side" | "commander";
}>;

/** The types shown, in the order players usually list them. */
export const TYPE_ORDER = [
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Battle",
  "Land",
] as const;

export type DeckStats = Readonly<{
  /** Non-land cards at mana value 0–6, and 7 or more in the last bucket. */
  curve: readonly number[];
  /** Cards per type (a card counts once, as its first type in TYPE_ORDER), plus "Other". */
  types: Readonly<Record<string, number>>;
  /** Average mana value of the non-land cards, or 0 when there are none. */
  averageManaValue: number;
}>;

/** The first matching type, in TYPE_ORDER ("Artifact Creature" is a Creature). */
export function mainType(typeLine: string): string {
  return TYPE_ORDER.find((type) => new RegExp(`\\b${type}\\b`).test(typeLine)) ?? "Other";
}

/** Stats for what you play with: the main deck and commander, not the sideboard. */
export function deckStats(lines: readonly StatsLine[]): DeckStats {
  const curve = Array.from({ length: 8 }, () => 0);
  const types: Record<string, number> = {};
  let spells = 0;
  let totalManaValue = 0;
  for (const line of lines) {
    if (line.board === "side") continue;
    const type = mainType(line.typeLine);
    types[type] = (types[type] ?? 0) + line.quantity;
    if (type === "Land") continue;
    curve[Math.min(7, Math.floor(line.manaValue))] += line.quantity;
    spells += line.quantity;
    totalManaValue += line.manaValue * line.quantity;
  }
  return { curve, types, averageManaValue: spells === 0 ? 0 : totalManaValue / spells };
}
