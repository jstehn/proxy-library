import { Cents } from "@/shared/kernel";
import {
  type CardFacts,
  type CardIdentity,
  curveSlot,
  curveSlotLabel,
  type SignalIO,
  type Tag,
  THEME_LABELS,
  type Theme,
} from "@/shared/mtg";
import type { Bracket, Format, EdhrecSignal, TargetedTag } from "@/modules/decks/core/client";
import { formatRules } from "@/modules/decks/core/client";
import {
  EMBED_SIM_BASELINE,
  RATING_BIAS,
  RATING_WEIGHTS,
  weightsForBracket,
  type RatingWeights,
} from "./rating-weights";
import { deckSignalProfile, NO_SIGNALS, synergyMatches, type DeckSignalProfile } from "./signals";

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
