import {
  type CardFacts,
  type CardIdentity,
  Cents,
  curveSlot,
  curveSlotLabel,
  type SignalIO,
  type Tag,
  THEME_LABELS,
  type Theme,
} from "@/shared/kernel";
import type { Bracket } from "../../domain/brackets";
import type { Format } from "../../domain/deck";
import { formatRules } from "../../domain/format-rules";
import { deckSignalProfile, NO_SIGNALS, synergyMatches, type DeckSignalProfile } from "./signals";
import type { EdhrecSignal, TargetedTag } from "../../domain/stats";

// Unified 0–100 Card Rating (design doc 46, #53/#55/#56/#59):
// combines produces/consumes synergy, theme/tribe/keyword fit, EDHREC community stats,
// role deficit, global quality prior, and curve/price/bracket penalties.

export type RatingPartKind =
  | "synergy"
  | "themeFit"
  | "embedSim"
  | "edhrec"
  | "combo"
  | "roleNeed"
  | "quality"
  | "curvePenalty"
  | "pricePenalty"
  | "bracketPenalty";

export type RatingPart = Readonly<{
  kind: RatingPartKind;
  contribution: number;
  label: string;
}>;

export type CardRating = Readonly<{
  /** Integer in [0, 100]: Math.round(100 * sigmoid(logit)). */
  rating: number;
  logit: number;
  parts: readonly RatingPart[];
}>;

/** A role the deck is short of: `count` cards do it, and its format wants `target`. */
export type RoleGap = Readonly<{ tag: TargetedTag; count: number; target: number }>;

/** What a deck is about: worked out from its lines (`deckProfile`), never stored. */
export type RatingProfile = Readonly<{
  format: Format;
  themes: readonly Theme[];
  /** Creature types the deck cares about, singular: "Elf". */
  tribes: readonly string[];
  gaps: readonly RoleGap[];
  keywords: readonly string[];
  signals: DeckSignalProfile;
  averageManaValue: number;
  /** Non-land card counts per clamped mana-value bucket (0..6). */
  curveCounts: readonly number[];
}>;

export type RatingCandidate = Pick<CardIdentity, "oracleId"> &
  Pick<CardFacts, "name" | "typeLine" | "manaValue"> &
  Readonly<{
    signals?: SignalIO;
    keywords: readonly string[];
    roles: readonly Tag[];
    themes: readonly Theme[];
    rarity: string;
    priceCents: number | null;
    edhrec?: EdhrecSignal | null;
    edhrecRank?: number | null;
    preconCount?: number | null;
    /** The card takes the deck over the bracket its owner aims for (cuts say so, design doc 31). */
    overBracket?: boolean;
    /** Names of cards already in the deck that form a two-card combo with this candidate. */
    comboPartners?: readonly string[] | null;
    /** Mean cosine similarity to top-5 most similar deck cards, in [0, 1] (design doc 53). */
    embedSim?: number | null;
  }>;

export type RatingOptions = Readonly<{
  maxCardPriceCents?: number | null;
  targetBracket?: Bracket | null;
  weightsOverride?: RatingWeights;
}>;

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
 * `scripts/fit-rating-weights.ts` runs a class-balanced logistic regression (`fitLogisticWeights`)
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

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

const RARITY_PRIOR: Readonly<Record<string, number>> = {
  common: 0,
  uncommon: 0.3,
  rare: 0.6,
  mythic: 0.8,
};

/**
 * How strong a card is on its own, about 0–1.6, from rarity and price: the quality prior's
 * fallback, and a tie-break where nothing better is known.
 */
export function strength(card: Pick<RatingCandidate, "rarity" | "priceCents">): number {
  const price = card.priceCents ?? 0;
  // log10 squeezes prices: $1 adds a little, $10 adds 0.8, $100 no more than $10.
  return (RARITY_PRIOR[card.rarity] ?? 0.3) + 0.8 * Math.min(1, Math.log10(1 + price / 100));
}

/** Global card quality prior in [0, 1] from edhrec_rank + precon frequency (fallback: rarity/price). */
export function qualityPrior(
  card: Pick<RatingCandidate, "edhrecRank" | "preconCount" | "rarity" | "priceCents">,
): number {
  const edhrecRank = card.edhrecRank;
  const preconCount = card.preconCount;
  const hasRank = edhrecRank !== undefined && edhrecRank !== null;
  const hasPrecon = preconCount !== undefined && preconCount !== null && preconCount > 0;
  if (hasRank || hasPrecon) {
    const rankScore = hasRank
      ? Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, edhrecRank)) / 4.5))
      : 0;
    const preconScore = hasPrecon ? Math.min(1, Math.log1p(preconCount) / Math.log1p(20)) : 0;
    if (hasRank && hasPrecon) return 0.75 * rankScore + 0.25 * preconScore;
    return hasRank ? rankScore : preconScore;
  }
  return strength(card) / 1.6;
}

const LIFT_EPS = 0.005;

/**
 * Smoothed log-lift from EDHREC inclusion rate and synergy (`baseline = inclusionRate - synergy`).
 * Symmetric around 0: staples with `synergy ≈ 0` score `≈ 0` lift instead of being penalized.
 */
export function edhrecLogLift(inclusionRate: number, synergy: number): number {
  const inc = Math.max(LIFT_EPS, Math.min(1, inclusionRate));
  const baseline = Math.max(LIFT_EPS, Math.min(1, inclusionRate - synergy));
  return Math.log(inc / baseline);
}

export type RatingFeatureVector = Readonly<{
  synergyTotal: number;
  themeCount: number;
  tribeCount: number;
  keywordCount: number;
  embedSimDelta: number;
  edhrecLift: number;
  edhrecInclusion: number;
  comboCount: number;
  roleNeed: number;
  quality: number;
  topHeavy: number;
  saturatedSlot: number;
  overPriceCap: number;
  overBracket: number;
}>;

type ComputedRatingFeatures = Readonly<{
  features: RatingFeatureVector;
  synergyMatches: readonly { tag: Theme; deckWeight: number }[];
  fitLabels: readonly string[];
  filledRoles: readonly string[];
}>;

function computeRatingFeatures(
  card: RatingCandidate,
  profile: RatingProfile,
  options: RatingOptions = {},
  keywordCap: number = RATING_WEIGHTS.keywordCap,
): ComputedRatingFeatures {
  let synergyTotal = 0;
  let synergyMatchList: readonly { tag: Theme; deckWeight: number }[] = [];
  const { total, matches } = synergyMatches(card.signals ?? NO_SIGNALS, profile.signals);
  if (total > 0 && matches.length > 0) {
    synergyTotal = total;
    synergyMatchList = matches;
  }

  let themeCount = 0;
  let tribeCount = 0;
  const fitLabels: string[] = [];
  for (const theme of profile.themes) {
    if (!card.themes.includes(theme)) continue;
    themeCount += 1;
    fitLabels.push(theme);
  }
  for (const tribe of profile.tribes) {
    const front = card.typeLine.split(" // ")[0];
    const subtypes = front.split(" — ")[1] ?? "";
    const hasTribe =
      subtypes.split(" ").includes(tribe) ||
      card.keywords.some((k) => k.toLowerCase() === "changeling");
    if (!hasTribe) continue;
    tribeCount += 1;
    fitLabels.push(tribe);
  }
  const sharedKeywords = card.keywords.filter((k) => profile.keywords.includes(k));
  const cappedKeywords = sharedKeywords.slice(0, keywordCap);
  for (const kw of cappedKeywords) {
    fitLabels.push(kw);
  }

  const embedSimDelta =
    card.embedSim != null && card.embedSim > EMBED_SIM_BASELINE
      ? card.embedSim - EMBED_SIM_BASELINE
      : 0;

  let edhrecLift = 0;
  let edhrecInclusion = 0;
  if (card.edhrec) {
    const totalDecks = card.edhrec.totalDecks ?? 200;
    const confidence = Math.min(1, Math.max(0.25, totalDecks / 100));
    edhrecInclusion = confidence * Math.max(0, card.edhrec.inclusionRate);
    const rawLift = Math.max(
      -2,
      Math.min(2, edhrecLogLift(card.edhrec.inclusionRate, card.edhrec.synergy)),
    );
    if (rawLift >= 0 || totalDecks >= 50) {
      edhrecLift = confidence * rawLift;
    }
  }

  const comboCount =
    card.comboPartners && card.comboPartners.length > 0
      ? Math.min(2, card.comboPartners.length)
      : 0;

  let roleNeed = 0;
  const filledRoles: string[] = [];
  for (const gap of profile.gaps) {
    if (!card.roles.includes(gap.tag)) continue;
    const deficitRatio = Math.max(0.1, (gap.target - gap.count) / Math.max(1, gap.target));
    roleNeed += deficitRatio;
    filledRoles.push(`${gap.tag} ${gap.count}/${gap.target}`);
  }

  const quality = qualityPrior(card);

  const isHighCurve = profile.averageManaValue > formatRules(profile.format).curveGuide;
  const bucketCount = profile.curveCounts[curveSlot(card.manaValue)] ?? 0;
  const saturated = bucketCount >= formatRules(profile.format).roleSlotSaturation;
  const topHeavy = isHighCurve && card.manaValue >= 5 ? 1 : 0;
  const saturatedSlot = saturated ? 1 : 0;

  const overPriceCap =
    options.maxCardPriceCents != null &&
    card.priceCents !== null &&
    card.priceCents > options.maxCardPriceCents
      ? 1
      : 0;

  const overBracket = card.overBracket ? 1 : 0;

  return {
    features: {
      synergyTotal,
      themeCount,
      tribeCount,
      keywordCount: cappedKeywords.length,
      embedSimDelta,
      edhrecLift,
      edhrecInclusion,
      comboCount,
      roleNeed,
      quality,
      topHeavy,
      saturatedSlot,
      overPriceCap,
      overBracket,
    },
    synergyMatches: synergyMatchList,
    fitLabels,
    filledRoles,
  };
}

/** Extracts the raw feature vector used by `rateCard` and logistic-regression calibration. */
export function ratingFeatureVector(
  card: RatingCandidate,
  profile: RatingProfile,
  options: RatingOptions = {},
): RatingFeatureVector {
  const weights = weightsForBracket(options.targetBracket ?? null);
  return computeRatingFeatures(card, profile, options, weights.keywordCap).features;
}

/**
 * Compute a calibrated 0–100 rating and explainable parts for a candidate card in a deck.
 */
export function rateCard(
  card: RatingCandidate,
  profile: RatingProfile,
  options: RatingOptions = {},
): CardRating {
  const weights = options.weightsOverride ?? weightsForBracket(options.targetBracket ?? null);
  const {
    features,
    synergyMatches: matches,
    fitLabels,
    filledRoles,
  } = computeRatingFeatures(card, profile, options, weights.keywordCap);
  const parts: RatingPart[] = [];

  // 1. Produces/consumes oracle-text synergy (#54)
  if (features.synergyTotal > 0 && matches.length > 0) {
    const contribution = Math.min(weights.synergyCap, weights.synergy * features.synergyTotal);
    const top = matches
      .slice(0, 2)
      .map((m) => `${THEME_LABELS[m.tag]} ×${m.deckWeight}`)
      .join(", ");
    parts.push({
      kind: "synergy",
      contribution,
      label: `matches ${top}`,
    });
  }

  // 2. Theme, tribe & commander keyword fit
  const themeContribution =
    features.themeCount * weights.theme +
    features.tribeCount * weights.tribe +
    features.keywordCount * weights.keyword;
  if (themeContribution > 0) {
    parts.push({
      kind: "themeFit",
      contribution: themeContribution,
      label: `fits ${fitLabels.slice(0, 3).join(", ")}`,
    });
  }

  // 2b. Frozen text embedding similarity (#58, design doc 53)
  if (features.embedSimDelta > 0 && weights.embedSim > 0 && card.embedSim != null) {
    parts.push({
      kind: "embedSim",
      contribution: weights.embedSim * features.embedSimDelta,
      label: `reads like deck (${Math.round(card.embedSim * 100)}% sim)`,
    });
  }

  // 3. EDHREC community signal (#86, Phase 58: separate inclusion staple power from log-lift)
  if (card.edhrec) {
    if (features.edhrecInclusion > 0) {
      parts.push({
        kind: "edhrec",
        contribution: weights.edhrecInclusion * features.edhrecInclusion,
        label: `EDHREC ${Math.round(card.edhrec.inclusionRate * 100)}% inclusion`,
      });
    }
    if (Math.abs(features.edhrecLift) >= 0.05) {
      parts.push({
        kind: "edhrec",
        contribution: weights.edhrecLift * features.edhrecLift,
        label: `EDHREC ${features.edhrecLift >= 0 ? "+" : ""}${features.edhrecLift.toFixed(2)} lift`,
      });
    }
  }

  // 3b. Commander Spellbook two-card combo partner (design doc 52)
  if (features.comboCount > 0 && weights.combo > 0 && card.comboPartners) {
    parts.push({
      kind: "combo",
      contribution: weights.combo * features.comboCount,
      label: `Combos with ${card.comboPartners.slice(0, 2).join(", ")}`,
    });
  }

  // 4. Role need (#55) — scaled by how short the deck is
  if (features.roleNeed > 0) {
    parts.push({
      kind: "roleNeed",
      contribution: weights.roleNeed * features.roleNeed,
      label: `fills ${filledRoles.join(", ")}`,
    });
  }

  // 5. Global quality prior (#59)
  if (features.quality > 0) {
    parts.push({
      kind: "quality",
      contribution: weights.quality * features.quality,
      label:
        card.edhrecRank != null
          ? `EDHREC rank #${card.edhrecRank}`
          : card.preconCount
            ? `in ${card.preconCount} precons`
            : "card strength",
    });
  }

  // 6. Curve & saturation penalty (#55 / #56)
  const curvePenalty =
    features.topHeavy * weights.topHeavyPenalty +
    features.saturatedSlot * weights.saturatedSlotPenalty;
  if (curvePenalty < 0) {
    parts.push({
      kind: "curvePenalty",
      contribution: curvePenalty,
      label:
        features.topHeavy > 0
          ? `heavy (${card.manaValue} MV in ${profile.averageManaValue.toFixed(1)} avg deck)`
          : `crowded ${curveSlotLabel(curveSlot(card.manaValue))}-MV slot`,
    });
  }

  // 7. Optional price cap penalty (#56)
  if (features.overPriceCap > 0 && options.maxCardPriceCents != null) {
    parts.push({
      kind: "pricePenalty",
      contribution: weights.pricePenalty,
      label: `over ${Cents.format(Cents.of(options.maxCardPriceCents))} cap`,
    });
  }

  // 8. Optional bracket penalty (#56)
  if (features.overBracket > 0) {
    parts.push({
      kind: "bracketPenalty",
      contribution: weights.bracketPenalty,
      label: "over your target bracket",
    });
  }

  const logit = RATING_BIAS + parts.reduce((sum, p) => sum + p.contribution, 0);
  const rating = Math.max(0, Math.min(100, Math.round(100 * sigmoid(logit))));
  return { rating, logit, parts };
}

export function emptyRatingProfile(format: Format): RatingProfile {
  return {
    format,
    themes: [],
    tribes: [],
    gaps: [],
    keywords: [],
    signals: deckSignalProfile([]),
    averageManaValue: 0,
    curveCounts: [],
  };
}

export type CalibrationSample = Readonly<{
  features: RatingFeatureVector;
  label: 0 | 1;
}>;

export type FitLogisticOptions = Readonly<{
  learningRate?: number;
  epochs?: number;
  l2?: number;
}>;

type TrainableKey =
  | "synergy"
  | "theme"
  | "tribe"
  | "keyword"
  | "embedSim"
  | "roleNeed"
  | "edhrecLift"
  | "edhrecInclusion"
  | "combo"
  | "quality"
  | "topHeavyPenalty"
  | "saturatedSlotPenalty";

const TRAINABLE_KEYS: readonly {
  weight: TrainableKey;
  feature: keyof RatingFeatureVector;
  sign: 1 | -1;
  maxAbs: number;
}[] = [
  { weight: "synergy", feature: "synergyTotal", sign: 1, maxAbs: 2.5 },
  { weight: "theme", feature: "themeCount", sign: 1, maxAbs: 3.0 },
  { weight: "tribe", feature: "tribeCount", sign: 1, maxAbs: 3.0 },
  { weight: "keyword", feature: "keywordCount", sign: 1, maxAbs: 2.0 },
  { weight: "embedSim", feature: "embedSimDelta", sign: 1, maxAbs: 14.0 },
  { weight: "roleNeed", feature: "roleNeed", sign: 1, maxAbs: 3.0 },
  { weight: "edhrecLift", feature: "edhrecLift", sign: 1, maxAbs: 4.0 },
  { weight: "edhrecInclusion", feature: "edhrecInclusion", sign: 1, maxAbs: 5.0 },
  { weight: "combo", feature: "comboCount", sign: 1, maxAbs: 3.0 },
  { weight: "quality", feature: "quality", sign: 1, maxAbs: 4.0 },
  { weight: "topHeavyPenalty", feature: "topHeavy", sign: -1, maxAbs: 2.0 },
  { weight: "saturatedSlotPenalty", feature: "saturatedSlot", sign: -1, maxAbs: 2.0 },
];

/**
 * Fits `RatingWeights` via L2-regularized, class-balanced logistic regression over
 * `ratingFeatureVector` samples, shrinking toward `initial` and preserving feature signs.
 */
export function fitLogisticWeights(
  samples: readonly CalibrationSample[],
  initial: RatingWeights,
  options: FitLogisticOptions = {},
): RatingWeights {
  if (samples.length === 0) return initial;
  const lr = options.learningRate ?? 0.15;
  const epochs = options.epochs ?? 120;
  const l2 = options.l2 ?? 0.02;

  let positives = 0;
  let negatives = 0;
  for (const s of samples) {
    if (s.label === 1) positives += 1;
    else negatives += 1;
  }
  const posWeight = positives > 0 ? samples.length / (2 * positives) : 1;
  const negWeight = negatives > 0 ? samples.length / (2 * negatives) : 1;

  const w: Record<TrainableKey, number> = {
    synergy: initial.synergy,
    theme: initial.theme,
    tribe: initial.tribe,
    keyword: initial.keyword,
    embedSim: initial.embedSim,
    roleNeed: initial.roleNeed,
    edhrecLift: initial.edhrecLift,
    edhrecInclusion: initial.edhrecInclusion,
    combo: initial.combo,
    quality: initial.quality,
    topHeavyPenalty: initial.topHeavyPenalty,
    saturatedSlotPenalty: initial.saturatedSlotPenalty,
  };

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad: Record<TrainableKey, number> = {
      synergy: 0,
      theme: 0,
      tribe: 0,
      keyword: 0,
      embedSim: 0,
      roleNeed: 0,
      edhrecLift: 0,
      edhrecInclusion: 0,
      combo: 0,
      quality: 0,
      topHeavyPenalty: 0,
      saturatedSlotPenalty: 0,
    };

    for (const sample of samples) {
      const f = sample.features;
      const synPart = Math.min(initial.synergyCap, w.synergy * f.synergyTotal);
      const logit =
        RATING_BIAS +
        synPart +
        w.theme * f.themeCount +
        w.tribe * f.tribeCount +
        w.keyword * f.keywordCount +
        w.embedSim * f.embedSimDelta +
        w.roleNeed * f.roleNeed +
        w.edhrecLift * f.edhrecLift +
        w.edhrecInclusion * f.edhrecInclusion +
        w.combo * f.comboCount +
        w.quality * f.quality +
        w.topHeavyPenalty * f.topHeavy +
        w.saturatedSlotPenalty * f.saturatedSlot;
      const pred = sigmoid(logit);
      const err = (pred - sample.label) * (sample.label === 1 ? posWeight : negWeight);

      for (const spec of TRAINABLE_KEYS) {
        const val = f[spec.feature];
        if (val !== 0) grad[spec.weight] += err * val;
      }
    }

    for (const spec of TRAINABLE_KEYS) {
      const key = spec.weight;
      const step = grad[key] / samples.length + l2 * (w[key] - initial[key]);
      const updated = w[key] - lr * step;
      w[key] =
        spec.sign === 1
          ? Math.max(0, Math.min(spec.maxAbs, updated))
          : Math.min(0, Math.max(-spec.maxAbs, updated));
    }
  }

  return {
    ...initial,
    synergy: Number(w.synergy.toFixed(3)),
    theme: Number(w.theme.toFixed(3)),
    tribe: Number(w.tribe.toFixed(3)),
    keyword: Number(w.keyword.toFixed(3)),
    embedSim: Number(w.embedSim.toFixed(3)),
    roleNeed: Number(w.roleNeed.toFixed(3)),
    edhrecLift: Number(w.edhrecLift.toFixed(3)),
    edhrecInclusion: Number(w.edhrecInclusion.toFixed(3)),
    combo: Number(w.combo.toFixed(3)),
    quality: Number(w.quality.toFixed(3)),
    topHeavyPenalty: Number(w.topHeavyPenalty.toFixed(3)),
    saturatedSlotPenalty: Number(w.saturatedSlotPenalty.toFixed(3)),
  };
}
