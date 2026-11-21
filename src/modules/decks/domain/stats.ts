import {
  type CardFacts,
  COLORS,
  CURVE_SLOTS,
  curveSlot,
  hasTypeWord,
  isCreature,
  isLand,
  type ManaColor,
  type ManaSymbol,
  type SignalIO,
  type Tag,
  TAGS,
  type Theme,
} from "@/shared/kernel";
import { isCounted, isPlayed, type DeckCount } from "./boards";
import { costSymbols } from "./mana-symbols";

// Deck statistics for the builder: the mana curve, card types and average mana value (lesson 09,
// exercise 5 became this), and role counts (design doc 19). Pure: lines in, numbers out.

/** Community Commander statistics for a card under this deck's commander (design doc 45). */
export type EdhrecSignal = Readonly<{
  inclusionRate: number;
  synergy: number;
  totalDecks?: number;
}>;

export type StatsLine = DeckCount &
  Pick<CardFacts, "manaValue" | "typeLine"> &
  Readonly<{
    /** e.g. "{2}{W}{U}"; missing or null for cards without a cost (lands). */
    manaCost?: string | null;
    /** Colors of mana it can make: "W", "U", "B", "R", "G", "C" (lands, rocks, dorks). */
    producedMana?: readonly string[];
    /** Market price of one copy, in cents, if known. */
    priceCents?: number | null;
    /** Rules text of every face, for themes (design doc 20). */
    text?: string;
    /** What job the card does in a deck (the catalog's card features). Missing: no tags. */
    roles?: readonly Tag[];
    /** What deck the card plays into, and what deck it leads as a commander (card features). */
    themes?: readonly Theme[];
    leaderThemes?: readonly Theme[];
    /** The themes it makes and uses, for matching it to the deck it plays in (card features). */
    signals?: SignalIO;
  }>;

/** A deck line as the profile reads it: the statistics' line, plus its keyword abilities. */
export type ProfileLine = StatsLine & Readonly<{ keywords?: readonly string[] }>;

export type ManaSource = ManaSymbol;

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
  /** Cards in the sideboard (excluded from played stats, included in price and copy limits). */
  sideboardCount: number;
  /** Lands (a card with a land on either face, artifact lands included). */
  lands: number;
  /** Non-land cards that make mana (rocks, dorks, rituals). */
  otherManaSources: number;
  /** Colored mana symbols in the spells' costs: what the deck needs. */
  pips: Readonly<Record<ManaColor, number>>;
  /** Cards (lands and other sources) that can make each color: what the deck has. */
  sources: Readonly<Record<ManaSource, number>>;
  /** The whole deck's market value, sideboard included, in cents (unknown prices count 0). */
  priceCents: number;
  /** Cards (main deck and commander) with each role; a card with two roles counts in both. */
  tags: Readonly<Record<Tag, number>>;
}>;

/** The first matching type, in TYPE_ORDER ("Artifact Creature" is a Creature). */
export function mainType(typeLine: string): string {
  return TYPE_ORDER.find((type) => hasTypeWord(typeLine, [type])) ?? "Other";
}

// A card with a land on either face is a land (STATUS decision 1); the rule is in the kernel.
export { isLand };

/**
 * The colored symbols in a mana cost, per color. A hybrid symbol ({W/U}) counts toward both of
 * its colors, a Phyrexian one ({W/P}) toward its color; generic and colorless ones toward none.
 */
export function colorPips(manaCost: string | null | undefined): Record<ManaColor, number> {
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const symbol of costSymbols(manaCost ?? null)) {
    for (const color of COLORS) if (symbol.includes(color)) pips[color] += 1;
  }
  return pips;
}

/** Stats for what you play with: the main deck and commander, not the sideboard. */
export function deckStats(lines: readonly StatsLine[]): DeckStats {
  const curve = CURVE_SLOTS.map(() => 0);
  const creatureCurve = CURVE_SLOTS.map(() => 0);
  const types: Record<string, number> = {};
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const sources: Record<ManaSource, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let spells = 0;
  let totalManaValue = 0;
  let cardCount = 0;
  let sideboardCount = 0;
  let lands = 0;
  let otherManaSources = 0;
  let priceCents = 0;
  const tags = Object.fromEntries(TAGS.map((tag) => [tag, 0])) as Record<Tag, number>;

  for (const line of lines) {
    // The maybeboard is counted nowhere; the sideboard only in count, limits, and deck's value.
    if (!isCounted(line.board)) continue;
    priceCents += (line.priceCents ?? 0) * line.quantity;
    if (line.board === "side") sideboardCount += line.quantity;
    if (!isPlayed(line.board)) continue;
    cardCount += line.quantity;
    const type = mainType(line.typeLine);
    types[type] = (types[type] ?? 0) + line.quantity;
    const produced = line.producedMana ?? [];
    for (const tag of line.roles ?? []) tags[tag] += line.quantity;
    for (const color of produced) {
      if (color in sources) sources[color as ManaSource] += line.quantity;
    }
    if (isLand(line.typeLine)) {
      lands += line.quantity;
      continue;
    }
    if (produced.length > 0) otherManaSources += line.quantity;
    const bucket = curveSlot(line.manaValue);
    curve[bucket] += line.quantity;
    if (isCreature(line.typeLine)) creatureCurve[bucket] += line.quantity;
    spells += line.quantity;
    totalManaValue += line.manaValue * line.quantity;
    const linePips = colorPips(line.manaCost);
    for (const color of COLORS) pips[color] += linePips[color] * line.quantity;
  }
  return {
    curve,
    creatureCurve,
    types,
    averageManaValue: spells === 0 ? 0 : totalManaValue / spells,
    cardCount,
    sideboardCount,
    lands,
    otherManaSources,
    pips,
    sources,
    priceCents,
    tags,
  };
}

/** The roles that have a target to aim for; the rest are only counted. */
export const TARGETED_TAGS = ["ramp", "draw", "removal", "wipe"] as const satisfies readonly Tag[];
export type TargetedTag = (typeof TARGETED_TAGS)[number];
