import type { Tag, Theme } from "@/shared/card-search";
import type { Format } from "./deck";
import {
  cardSignalIO as cardSignalIOFromText,
  deckSignalProfile,
  SIGNAL_LABELS,
  synergyMatches,
  type DeckSignalProfile,
} from "./signals";
import type { TargetedTag } from "./stats";

// Unified 0–100 Card Rating (design doc 46, #53/#55/#56/#59):
// combines produces/consumes synergy, theme/tribe/keyword fit, EDHREC community stats,
// role deficit, global quality prior, and curve/price/bracket penalties.

export type RatingPartKind =
  | "synergy"
  | "themeFit"
  | "edhrec"
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

export type RatingEdhrecSignal = Readonly<{
  inclusionRate: number;
  synergy: number;
  totalDecks?: number;
}>;

export type RatingRoleGap = Readonly<{ tag: TargetedTag; count: number; target: number }>;

export type RatingProfile = Readonly<{
  format: Format;
  themes: readonly Theme[];
  tribes: readonly string[];
  gaps: readonly RatingRoleGap[];
  keywords: readonly string[];
  signals: DeckSignalProfile;
  averageManaValue: number;
  /** Non-land card counts per clamped mana-value bucket (0..6). */
  curveCounts: ReadonlyMap<number, number>;
}>;

export type RatingCandidate = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  manaValue: number;
  text?: string;
  keywords: readonly string[];
  roles: readonly Tag[];
  themes: readonly Theme[];
  rarity: string;
  priceCents: number | null;
  edhrec?: RatingEdhrecSignal | null;
  edhrecRank?: number | null;
  preconCount?: number | null;
  isGameChanger?: boolean;
}>;

export type RatingOptions = Readonly<{
  maxCardPriceCents?: number | null;
  penalizeGameChanger?: boolean;
}>;

export const RATING_BIAS = -1.2;

export const RATING_WEIGHTS = {
  synergy: 0.45,
  synergyCap: 2.2,
  theme: 0.65,
  tribe: 0.7,
  keyword: 0.25,
  keywordCap: 2,
  roleNeed: 0.85,
  edhrecSynergy: 2.2,
  edhrecInclusion: 1.2,
  edhrecNegative: -0.9,
  quality: 1.1,
  topHeavyPenalty: -0.45,
  saturatedSlotPenalty: -0.35,
  pricePenalty: -0.9,
  bracketPenalty: -1.4,
} as const;

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

const RARITY_PRIOR: Readonly<Record<string, number>> = {
  common: 0,
  uncommon: 0.3,
  rare: 0.6,
  mythic: 0.8,
};

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
  const price = card.priceCents ?? 0;
  const fallback =
    (RARITY_PRIOR[card.rarity] ?? 0.3) + 0.8 * Math.min(1, Math.log10(1 + price / 100));
  return Math.max(0, Math.min(1, fallback / 1.6));
}

function curveBucket(manaValue: number): number {
  return Math.min(6, Math.max(0, Math.floor(manaValue)));
}

function curveGuide(format: Format): number {
  return format === "commander" ? 3.3 : 3.0;
}

function slotSaturationThreshold(format: Format): number {
  return format === "commander" ? 20 : 12;
}

/**
 * Compute a calibrated 0–100 rating and explainable parts for a candidate card in a deck.
 */
export function rateCard(
  card: RatingCandidate,
  profile: RatingProfile,
  options: RatingOptions = {},
): CardRating {
  const parts: RatingPart[] = [];

  // 1. Produces/consumes oracle-text synergy (#54)
  if (card.text !== undefined && card.text.length > 0) {
    const io = {
      name: card.name,
      typeLine: card.typeLine,
      text: card.text,
      manaValue: card.manaValue,
    };
    const { total, matches } = synergyMatches(
      // Lazily imported/computed via deckSignalProfile helper
      cardSignalIOFromText(io),
      profile.signals,
    );
    if (total > 0 && matches.length > 0) {
      const contribution = Math.min(RATING_WEIGHTS.synergyCap, RATING_WEIGHTS.synergy * total);
      const top = matches
        .slice(0, 2)
        .map((m) => `${SIGNAL_LABELS[m.tag]} ×${m.deckWeight}`)
        .join(", ");
      parts.push({
        kind: "synergy",
        contribution,
        label: `matches ${top}`,
      });
    }
  }

  // 2. Theme, tribe & commander keyword fit
  let themeContribution = 0;
  const fitLabels: string[] = [];
  for (const theme of profile.themes) {
    if (!card.themes.includes(theme)) continue;
    themeContribution += RATING_WEIGHTS.theme;
    fitLabels.push(theme);
  }
  for (const tribe of profile.tribes) {
    const front = card.typeLine.split(" // ")[0];
    const subtypes = front.split(" — ")[1] ?? "";
    const hasTribe =
      subtypes.split(" ").includes(tribe) ||
      card.keywords.some((k) => k.toLowerCase() === "changeling");
    if (!hasTribe) continue;
    themeContribution += RATING_WEIGHTS.tribe;
    fitLabels.push(tribe);
  }
  const sharedKeywords = card.keywords.filter((k) => profile.keywords.includes(k));
  for (const kw of sharedKeywords.slice(0, RATING_WEIGHTS.keywordCap)) {
    themeContribution += RATING_WEIGHTS.keyword;
    fitLabels.push(kw);
  }
  if (themeContribution > 0) {
    parts.push({
      kind: "themeFit",
      contribution: themeContribution,
      label: `fits ${fitLabels.slice(0, 3).join(", ")}`,
    });
  }

  // 3. EDHREC community signal (#86)
  if (card.edhrec) {
    const totalDecks = card.edhrec.totalDecks ?? 200;
    const confidence = Math.min(1, Math.max(0.25, totalDecks / 100));
    if (card.edhrec.synergy >= 0.05 || card.edhrec.inclusionRate >= 0.15) {
      const contribution =
        confidence *
        (RATING_WEIGHTS.edhrecSynergy * Math.max(0, card.edhrec.synergy) +
          RATING_WEIGHTS.edhrecInclusion * Math.max(0, card.edhrec.inclusionRate));
      parts.push({
        kind: "edhrec",
        contribution,
        label: `EDHREC ${Math.round(card.edhrec.inclusionRate * 100)}% (${card.edhrec.synergy >= 0 ? "+" : ""}${Math.round(card.edhrec.synergy * 100)}% syn)`,
      });
    } else if (card.edhrec.synergy <= -0.1 && totalDecks >= 50) {
      parts.push({
        kind: "edhrec",
        contribution: RATING_WEIGHTS.edhrecNegative * Math.abs(card.edhrec.synergy),
        label: `low EDHREC synergy (${Math.round(card.edhrec.synergy * 100)}%)`,
      });
    }
  }

  // 4. Role need (#55) — scaled by how short the deck is
  let roleContribution = 0;
  const filledRoles: string[] = [];
  for (const gap of profile.gaps) {
    if (!card.roles.includes(gap.tag)) continue;
    const deficitRatio = Math.max(0.1, (gap.target - gap.count) / Math.max(1, gap.target));
    roleContribution += RATING_WEIGHTS.roleNeed * deficitRatio;
    filledRoles.push(`${gap.tag} ${gap.count}/${gap.target}`);
  }
  if (roleContribution > 0) {
    parts.push({
      kind: "roleNeed",
      contribution: roleContribution,
      label: `fills ${filledRoles.join(", ")}`,
    });
  }

  // 5. Global quality prior (#59)
  const prior = qualityPrior(card);
  if (prior > 0) {
    parts.push({
      kind: "quality",
      contribution: RATING_WEIGHTS.quality * prior,
      label:
        card.edhrecRank != null
          ? `EDHREC rank #${card.edhrecRank}`
          : card.preconCount
            ? `in ${card.preconCount} precons`
            : "card strength",
    });
  }

  // 6. Curve & saturation penalty (#55 / #56)
  const isHighCurve = profile.averageManaValue > curveGuide(profile.format);
  const bucketCount = profile.curveCounts.get(curveBucket(card.manaValue)) ?? 0;
  const saturated = bucketCount >= slotSaturationThreshold(profile.format);
  let curvePenalty = 0;
  if (isHighCurve && card.manaValue >= 5) {
    curvePenalty += RATING_WEIGHTS.topHeavyPenalty;
  }
  if (saturated) {
    curvePenalty += RATING_WEIGHTS.saturatedSlotPenalty;
  }
  if (curvePenalty < 0) {
    parts.push({
      kind: "curvePenalty",
      contribution: curvePenalty,
      label:
        isHighCurve && card.manaValue >= 5
          ? `heavy (${card.manaValue} MV in ${profile.averageManaValue.toFixed(1)} avg deck)`
          : `crowded ${curveBucket(card.manaValue)}-MV slot`,
    });
  }

  // 7. Optional price cap penalty (#56)
  if (
    options.maxCardPriceCents != null &&
    card.priceCents !== null &&
    card.priceCents > options.maxCardPriceCents
  ) {
    parts.push({
      kind: "pricePenalty",
      contribution: RATING_WEIGHTS.pricePenalty,
      label: `over $${(options.maxCardPriceCents / 100).toFixed(2)} cap`,
    });
  }

  // 8. Optional bracket penalty (#56)
  if (options.penalizeGameChanger && card.isGameChanger) {
    parts.push({
      kind: "bracketPenalty",
      contribution: RATING_WEIGHTS.bracketPenalty,
      label: "Game Changer",
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
    curveCounts: new Map(),
  };
}
