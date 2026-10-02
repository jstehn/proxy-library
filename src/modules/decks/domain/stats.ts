// Deck statistics for the builder: the mana curve, card types and average mana value (lesson 09,
// exercise 5 became this). Pure: lines in, numbers out.

export type StatsLine = Readonly<{
  quantity: number;
  manaValue: number;
  typeLine: string;
  board: "main" | "side" | "commander";
  /** e.g. "{2}{W}{U}"; missing or null for cards without a cost (lands). */
  manaCost?: string | null;
  /** Colors of mana it can make: "W", "U", "B", "R", "G", "C" (lands, rocks, dorks). */
  producedMana?: readonly string[];
  /** Market price of one copy, in cents, if known. */
  priceCents?: number | null;
}>;

export const MANA_COLORS = ["W", "U", "B", "R", "G"] as const;
export type ManaColor = (typeof MANA_COLORS)[number];
export type ManaSource = ManaColor | "C";

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
  /** The creatures within each bucket of `curve` (the rest are other spells). */
  creatureCurve: readonly number[];
  /** Cards per type (a card counts once, as its first type in TYPE_ORDER), plus "Other". */
  types: Readonly<Record<string, number>>;
  /** Average mana value of the non-land cards, or 0 when there are none. */
  averageManaValue: number;
  /** Cards in play: the main deck and commander (not the sideboard). */
  cardCount: number;
  /** Lands (a card whose front face is a land, artifact lands included). */
  lands: number;
  /** Non-land cards that make mana (rocks, dorks, rituals). */
  otherManaSources: number;
  /** Colored mana symbols in the spells' costs: what the deck needs. */
  pips: Readonly<Record<ManaColor, number>>;
  /** Cards (lands and other sources) that can make each color: what the deck has. */
  sources: Readonly<Record<ManaSource, number>>;
  /** The whole deck's market value, sideboard included, in cents (unknown prices count 0). */
  priceCents: number;
}>;

/** The first matching type, in TYPE_ORDER ("Artifact Creature" is a Creature). */
export function mainType(typeLine: string): string {
  return TYPE_ORDER.find((type) => new RegExp(`\\b${type}\\b`).test(typeLine)) ?? "Other";
}

/** Whether a card is a land: its front face's type line says so ("Instant // Land" doesn't). */
export function isLand(typeLine: string): boolean {
  return /\bLand\b/.test(typeLine.split(" // ")[0]);
}

/**
 * The colored symbols in a mana cost, per color. A hybrid symbol ({W/U}) counts toward both of
 * its colors, a Phyrexian one ({W/P}) toward its color; generic and colorless ones toward none.
 */
export function colorPips(manaCost: string | null | undefined): Record<ManaColor, number> {
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const symbol of manaCost?.match(/\{[^}]+\}/g) ?? []) {
    for (const color of MANA_COLORS) if (symbol.includes(color)) pips[color] += 1;
  }
  return pips;
}

/** Stats for what you play with: the main deck and commander, not the sideboard. */
export function deckStats(lines: readonly StatsLine[]): DeckStats {
  const curve = Array.from({ length: 8 }, () => 0);
  const creatureCurve = Array.from({ length: 8 }, () => 0);
  const types: Record<string, number> = {};
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const sources: Record<ManaSource, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let spells = 0;
  let totalManaValue = 0;
  let cardCount = 0;
  let lands = 0;
  let otherManaSources = 0;
  let priceCents = 0;

  for (const line of lines) {
    priceCents += (line.priceCents ?? 0) * line.quantity;
    if (line.board === "side") continue;
    cardCount += line.quantity;
    const type = mainType(line.typeLine);
    types[type] = (types[type] ?? 0) + line.quantity;
    const produced = line.producedMana ?? [];
    for (const color of produced) {
      if (color in sources) sources[color as ManaSource] += line.quantity;
    }
    if (isLand(line.typeLine)) {
      lands += line.quantity;
      continue;
    }
    if (produced.length > 0) otherManaSources += line.quantity;
    const bucket = Math.min(7, Math.floor(line.manaValue));
    curve[bucket] += line.quantity;
    if (/\bCreature\b/.test(line.typeLine)) creatureCurve[bucket] += line.quantity;
    spells += line.quantity;
    totalManaValue += line.manaValue * line.quantity;
    const linePips = colorPips(line.manaCost);
    for (const color of MANA_COLORS) pips[color] += linePips[color] * line.quantity;
  }
  return {
    curve,
    creatureCurve,
    types,
    averageManaValue: spells === 0 ? 0 : totalManaValue / spells,
    cardCount,
    lands,
    otherManaSources,
    pips,
    sources,
    priceCents,
  };
}

/**
 * How many cards a deck aims for: exactly 100 in Commander; at least 40 in limited (design doc
 * 17) and at least 60 in the other formats.
 */
export function deckSize(format: string): Readonly<{ cards: number; exact: boolean }> {
  if (format === "commander") return { cards: 100, exact: true };
  return { cards: format === "limited" ? 40 : 60, exact: false };
}

/** The usual land count to aim for: 37 of 100 in Commander, 17 of 40 in limited, else 24 of 60. */
export function suggestedLands(format: string): number {
  if (format === "commander") return 37;
  return format === "limited" ? 17 : 24;
}
