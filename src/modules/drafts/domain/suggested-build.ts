import type { Color } from "@/modules/catalog";
import {
  COLOR_ORDER,
  colorFit,
  factsOf,
  isBasicLand,
  isCreature,
  isLand,
  topColors,
  cardStrength,
  type DraftCardFacts,
  type FactsLookup,
} from "./auto-pick";
import { isConspiracyLine } from "./abilities";
import type { DraftCard } from "./draft";

// The deck each player gets when a draft ends (design doc 17, rule 12): the best 23 cards in the
// pool's two main colors, 17 basic lands split by how many mana symbols of each color the spells
// show, and everything else on the sideboard. A starting point to edit, not a final answer.

export const DECK_SIZE = 40;
export const SPELLS = 23;
/** Dual lands in your colors take the place of basics, up to this many. */
const MAX_DUALS = 3;

export type SuggestedBuild = Readonly<{
  colors: readonly Color[];
  main: readonly DraftCard[];
  side: readonly DraftCard[];
  basics: ReadonlyArray<{ color: Color; count: number }>;
}>;

/**
 * How many mana symbols of each color a mana cost shows. A hybrid symbol ({W/U}) counts half for
 * each color; Phyrexian ({W/P}) and "two or a color" ({2/W}) count for their color.
 */
export function colorPips(manaCost: string | null): Map<Color, number> {
  const pips = new Map<Color, number>();
  if (manaCost === null) return pips;
  // matchAll finds every {…} symbol, like re.finditer in Python.
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const colors = symbol
      .split("/")
      .filter((part): part is Color => (COLOR_ORDER as readonly string[]).includes(part));
    for (const color of colors) pips.set(color, (pips.get(color) ?? 0) + 1 / colors.length);
  }
  return pips;
}

/**
 * Splits `total` lands between colors in proportion to their weights, using the largest
 * remainder so the counts always add up exactly (17 × 0.6 = 10.2 → 10, and the spare land goes
 * to whichever color lost the most in rounding).
 */
export function splitLands(total: number, weights: ReadonlyMap<Color, number>): Map<Color, number> {
  const colors = COLOR_ORDER.filter((color) => (weights.get(color) ?? 0) > 0);
  const sum = colors.reduce((acc, color) => acc + (weights.get(color) ?? 0), 0);
  const counts = new Map<Color, number>();
  if (colors.length === 0 || total <= 0) return counts;

  const exact = colors.map((color) => ({
    color,
    share: (total * (weights.get(color) ?? 0)) / sum,
  }));
  for (const { color, share } of exact) counts.set(color, Math.floor(share));
  let left = total - [...counts.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)),
  );
  for (const { color } of byRemainder) {
    if (left === 0) break;
    counts.set(color, (counts.get(color) ?? 0) + 1);
    left -= 1;
  }
  return counts;
}

type Scored = { card: DraftCard; facts: DraftCardFacts; score: number };

export function suggestBuild(pool: readonly DraftCard[], lookup: FactsLookup): SuggestedBuild {
  const withFacts = pool.map((card) => ({ card, facts: factsOf(lookup, card.printingId) }));
  const colors = topColors(withFacts.map((each) => each.facts));
  const score = ({ card, facts }: { card: DraftCard; facts: DraftCardFacts }): Scored => ({
    card,
    facts,
    // A small bonus for creatures: a limited deck wants about 15 of them.
    score: cardStrength(facts) * colorFit(facts, colors, 1) + (isCreature(facts) ? 0.2 : 0),
  });
  const best = (a: Scored, b: Scored) => b.score - a.score || a.card.slot - b.card.slot;

  // Conspiracies start the game in the command zone, not the deck (CR 905.4): sideboard.
  const spells = withFacts
    .filter((each) => !isLand(each.facts) && !isConspiracyLine(each.facts.typeLine))
    .map(score);
  const onColor = spells
    .filter((each) => each.facts.colors.every((color) => colors.includes(color)))
    .sort(best);
  // Too few on-color playables: splash the best of the rest rather than play extra lands.
  const offColor = spells.filter((each) => !onColor.includes(each)).sort(best);
  const mainSpells = [...onColor, ...offColor].slice(0, SPELLS);

  const duals = withFacts
    .filter(
      (each) =>
        isLand(each.facts) &&
        !isBasicLand(each.facts) &&
        colors.length === 2 &&
        colors.every((color) => each.facts.producedMana.includes(color)),
    )
    .slice(0, MAX_DUALS);

  const pips = new Map<Color, number>();
  for (const { facts } of mainSpells) {
    for (const [color, count] of colorPips(facts.manaCost)) {
      pips.set(color, (pips.get(color) ?? 0) + count);
    }
  }
  // Spells with no colored symbols at all (artifacts): split the lands between the main colors.
  if (pips.size === 0) for (const color of colors) pips.set(color, 1);

  const landCount = Math.max(0, DECK_SIZE - mainSpells.length - duals.length);
  const basics = [...splitLands(landCount, pips)].map(([color, count]) => ({ color, count }));

  const inMain = new Set<DraftCard>([
    ...mainSpells.map((each) => each.card),
    ...duals.map((each) => each.card),
  ]);
  return {
    colors,
    main: pool.filter((card) => inMain.has(card)),
    side: pool.filter((card) => !inMain.has(card)),
    basics,
  };
}
