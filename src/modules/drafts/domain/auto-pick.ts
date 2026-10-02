import type { Color, PrintingId, Rarity } from "@/modules/catalog";
import type { Cents } from "@/shared/kernel";
import type { DraftCard, DraftPack } from "./draft";

// Choosing a card the way a sensible drafter would (design doc 17, section 5): take the strongest
// card early, then settle into two colors, fill the curve and get enough creatures. Pure and
// deterministic, so the same pack and pool always give the same card (rule 11).
//
// We have no limited ratings offline, so "strong" means rarity, with the market price as a weak
// hint. A ratings table could replace `cardStrength` later without touching the rest.

/** What the scoring needs to know about a printing. */
export type DraftCardFacts = Readonly<{
  name: string;
  rarity: Rarity;
  colors: readonly Color[];
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  producedMana: readonly Color[];
  marketPrice: Cents | null;
}>;

export type FactsLookup = (printingId: PrintingId) => DraftCardFacts | undefined;

/** A card we know nothing about counts as a weak colorless common. */
const UNKNOWN: DraftCardFacts = {
  name: "Unknown card",
  rarity: "common",
  colors: [],
  manaCost: null,
  manaValue: 0,
  typeLine: "",
  producedMana: [],
  marketPrice: null,
};

export function factsOf(lookup: FactsLookup, printingId: PrintingId): DraftCardFacts {
  return lookup(printingId) ?? UNKNOWN;
}

export const COLOR_ORDER: readonly Color[] = ["W", "U", "B", "R", "G"];

const RARITY_STRENGTH: Readonly<Record<Rarity, number>> = {
  common: 1,
  uncommon: 1.6,
  rare: 2.4,
  mythic: 2.8,
  special: 2,
  bonus: 2,
};

export const isLand = (facts: DraftCardFacts) => /\bLand\b/.test(facts.typeLine);
export const isBasicLand = (facts: DraftCardFacts) =>
  /\bBasic\b/.test(facts.typeLine) && isLand(facts);
export const isCreature = (facts: DraftCardFacts) => /\bCreature\b/.test(facts.typeLine);

/** How good a card is on its own, about 0–4. Basic lands are worth nothing: they're free. */
export function cardStrength(facts: DraftCardFacts): number {
  if (isBasicLand(facts)) return 0;
  const price = facts.marketPrice ?? 0;
  // log10 squeezes prices: $1 adds a little, $10 adds 0.8, $100 adds no more than $10 does.
  const priceHint = 0.8 * Math.min(1, Math.log10(1 + price / 100));
  const strength = RARITY_STRENGTH[facts.rarity] + priceHint;
  if (!isLand(facts)) return strength;
  // Lands that make two or more colors fix your mana; other lands rarely make a limited deck.
  return facts.producedMana.length >= 2 ? strength * 0.7 : strength * 0.3;
}

/** How much of each color a pool has, weighting each card by its strength. */
export function colorWeights(pool: readonly DraftCardFacts[]): Map<Color, number> {
  const weights = new Map<Color, number>();
  for (const facts of pool) {
    if (facts.colors.length === 0) continue;
    const share = cardStrength(facts) / facts.colors.length;
    for (const color of facts.colors) weights.set(color, (weights.get(color) ?? 0) + share);
  }
  return weights;
}

/** The pool's main colors, strongest first (ties in WUBRG order), at most `count`. */
export function topColors(pool: readonly DraftCardFacts[], count = 2): Color[] {
  const weights = colorWeights(pool);
  return COLOR_ORDER.filter((color) => (weights.get(color) ?? 0) > 0)
    .sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0))
    .slice(0, count);
}

/**
 * How settled a drafter is in their colors: 0 for the first three picks, rising to 1 by pick 13.
 * Early picks take the best card; later ones stay in their lane.
 */
export function commitment(picksSoFar: number): number {
  return Math.min(1, Math.max(0, (picksSoFar - 2) / 10));
}

/**
 * How well a card's colors suit the pool: a bonus for fitting, a penalty for needing a color you
 * aren't playing. With only one main color so far, the second color is still open.
 */
export function colorFit(facts: DraftCardFacts, top: readonly Color[], settled: number): number {
  if (facts.colors.length === 0) return 1;
  const outside = facts.colors.filter((color) => !top.includes(color)).length;
  const stillOpen = Math.max(0, 2 - top.length);
  if (outside === 0) return 1 + 0.2 * settled;
  if (outside <= stillOpen) return 1;
  return 1 - 0.7 * settled;
}

/** About how many spells of each mana value a 23-spell limited deck wants (6 = six or more). */
export const IDEAL_CURVE: Readonly<Record<number, number>> = { 1: 1, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2 };

export const curveBucket = (manaValue: number) => Math.min(6, Math.max(1, Math.round(manaValue)));

/** Small nudges for what the pool is missing: creatures, a gap in the curve, fixing. */
function needsBonus(
  facts: DraftCardFacts,
  pool: readonly DraftCardFacts[],
  top: readonly Color[],
  settled: number,
): number {
  let bonus = 0;
  if (isLand(facts)) {
    const fixesUs = top.length === 2 && top.every((color) => facts.producedMana.includes(color));
    return fixesUs ? 0.3 * settled : 0;
  }
  if (isCreature(facts) && pool.filter(isCreature).length < 15) bonus += 0.2 * settled;
  const bucket = curveBucket(facts.manaValue);
  const sameCost = pool.filter((each) => !isLand(each) && curveBucket(each.manaValue) === bucket);
  if (sameCost.length >= IDEAL_CURVE[bucket] + 2) bonus -= 0.2 * settled;
  return bonus;
}

/** A card's value to this particular pool: strength × color fit + needs. */
export function pickScore(facts: DraftCardFacts, pool: readonly DraftCardFacts[]): number {
  if (isBasicLand(facts)) return 0;
  const settled = commitment(pool.length);
  const top = topColors(pool);
  return (
    cardStrength(facts) * colorFit(facts, top, settled) + needsBonus(facts, pool, top, settled)
  );
}

/** The slot to auto-pick: the best score, the earliest slot on a tie. */
export function chooseAutoPick(
  pack: Pick<DraftPack, "cards">,
  pool: readonly DraftCard[],
  lookup: FactsLookup,
): number {
  const poolFacts = pool.map((card) => factsOf(lookup, card.printingId));
  let best: { slot: number; score: number } | null = null;
  for (const card of pack.cards) {
    if (card.pick !== null) continue;
    const score = pickScore(factsOf(lookup, card.printingId), poolFacts);
    if (best === null || score > best.score) best = { slot: card.slot, score };
  }
  if (best === null) throw new Error("chooseAutoPick needs a pack with a card left");
  return best.slot;
}
