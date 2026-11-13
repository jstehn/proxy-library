import { rateCard, type CardRating, type RatingOptions, type RatingProfile } from "./rate";
import type { CandidateCard } from "./suggest";

// Pure ranking for budget replacements of expensive deck cards (design doc 53).

export type ReplacementCandidate = Readonly<{
  card: CandidateCard;
  /** Cosine similarity in [0, 1] between this card's embedding and the expensive card's embedding. */
  similarity: number;
}>;

export type BudgetReplacement = Readonly<{
  card: CandidateCard;
  similarityPct: number;
  rating: CardRating;
  savedCents: number;
  score: number;
}>;

export type BudgetReplacementOptions = RatingOptions &
  Readonly<{
    maxPriceCents?: number;
    limit?: number;
  }>;

const SIMILARITY_WEIGHT = 0.7;
const DECK_FIT_WEIGHT = 0.3;
const DEFAULT_LIMIT = 5;

export function rankBudgetReplacements(
  target: { priceCents: number },
  candidates: readonly ReplacementCandidate[],
  profile: RatingProfile,
  options: BudgetReplacementOptions = {},
): BudgetReplacement[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return [];

  const results: BudgetReplacement[] = [];
  for (const { card, similarity } of candidates) {
    if (card.priceCents === null) continue;
    if (card.priceCents >= target.priceCents) continue;
    if (options.maxPriceCents !== undefined && card.priceCents > options.maxPriceCents) continue;

    const rating = rateCard(card, profile, options);
    const clampedSim = Math.max(0, Math.min(1, similarity));
    const score = clampedSim * SIMILARITY_WEIGHT + (rating.rating / 100) * DECK_FIT_WEIGHT;
    results.push({
      card,
      similarityPct: Math.round(clampedSim * 100),
      rating,
      savedCents: target.priceCents - card.priceCents,
      score,
    });
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.similarityPct - a.similarityPct ||
        (a.card.priceCents ?? 0) - (b.card.priceCents ?? 0) ||
        a.card.oracleId.localeCompare(b.card.oracleId),
    )
    .slice(0, limit);
}
