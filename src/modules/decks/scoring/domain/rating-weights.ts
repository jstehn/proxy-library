import type { Bracket } from "@/modules/decks/core/client";

// The card rating's weights (design doc 46): the one table `rateCard` reads, and the three power
// tiers fitted from it (see calibrate.ts). A data file: it holds numbers and nothing else.

export type PowerTier = "casual" | "upgraded" | "optimized";

export function powerTierForBracket(bracket: Bracket | null): PowerTier {
  if (bracket === null || bracket === 3) return "upgraded";
  return bracket <= 2 ? "casual" : "optimized";
}

export const RATING_BIAS = -1.2;

export const EMBED_SIM_BASELINE = 0.55;

/**
 * THE weight table: the one scorer (`rateCard`) judges a card for suggestions, cuts, "cards like
 * this one" and draft-a-deck with these numbers. They are FITTED FROM DATA, not tuned by hand:
 * `scripts/dev/fit-rating-weights.ts` runs a class-balanced logistic regression (`fitLogisticWeights`)
 * per power tier, on cards held out of real Commander precon decklists (positives) against cards
 * that aren't in the deck (negatives), and prints the numbers pasted here (last fitted
 * 2026-11-13). Only the four the data can't show (the two caps and the two penalties) are set by
 * hand. This table is the "upgraded" tier; the other two tiers below override the fitted ones.
 * If a result looks wrong, fit again or tell the owner; don't edit one number.
 */
export const RATING_WEIGHTS = {
  /** Per point of produces/consumes synergy with what the deck does (signals.ts). */
  synergy: 0.35,
  /** Most synergy can add (set by hand). */
  synergyCap: 2.2,
  /** Per theme of the deck the card plays into. */
  theme: 0.6,
  /** Per tribe of the deck the card belongs to (or a changeling). */
  tribe: 0.689,
  /** Per keyword the commander has and the card shares. */
  keyword: 0.229,
  /** Most keywords counted (set by hand). */
  keywordCap: 2,
  /** Per unit of text similarity to the deck above `EMBED_SIM_BASELINE`. */
  embedSim: 7.227,
  /** Per unit of how short the deck is of a role the card does. */
  roleNeed: 0.643,
  /** Per unit of EDHREC log-lift (how much likelier it is under this commander). */
  edhrecLift: 0.95,
  /** Per unit of EDHREC inclusion rate under this commander. */
  edhrecInclusion: 1.2,
  /** Per two-card combo with a card in the deck (at most two). */
  combo: 1.0,
  /** Per unit of the card's general quality (EDHREC rank, precons; rarity and price if unknown). */
  quality: 0.834,
  /** Expensive card in a deck whose curve is already high. */
  topHeavyPenalty: -0.395,
  /** Card of a mana value whose slot of the curve is already full. */
  saturatedSlotPenalty: -0.416,
  /** Over the player's price cap (set by hand). */
  pricePenalty: -0.9,
  /** Takes the deck over its target bracket (set by hand). */
  bracketPenalty: -1.4,
} as const;

export type RatingWeights = { readonly [K in keyof typeof RATING_WEIGHTS]: number };

const RATING_WEIGHTS_BY_TIER: Readonly<Record<PowerTier, RatingWeights>> = {
  casual: {
    ...RATING_WEIGHTS,
    synergy: 0.35,
    theme: 0.7,
    tribe: 0.844,
    keyword: 0.295,
    embedSim: 8.141,
    roleNeed: 0.69,
    edhrecInclusion: 0.8,
    combo: 0,
    quality: 0.366,
    topHeavyPenalty: -0.324,
    saturatedSlotPenalty: -0.288,
  },
  upgraded: RATING_WEIGHTS,
  optimized: {
    ...RATING_WEIGHTS,
    synergy: 0.4,
    synergyCap: 2.5,
    theme: 0.45,
    tribe: 0.599,
    keyword: 0.256,
    embedSim: 5.85,
    roleNeed: 0.708,
    edhrecLift: 1.1,
    edhrecInclusion: 1.5,
    combo: 1.6,
    quality: 1.294,
    topHeavyPenalty: -0.465,
    saturatedSlotPenalty: -0.538,
  },
};

export function weightsForBracket(targetBracket: Bracket | null): RatingWeights {
  return RATING_WEIGHTS_BY_TIER[powerTierForBracket(targetBracket)];
}
