// The pure code of decks/scoring that the other areas, the module root and the browser use (ADR 0016, 0029).
export {
  rankCuts,
  type CutContext,
  type CutLine,
  type CutReason,
  type RankedCut,
} from "./domain/cuts";
export {
  optimizeDeck,
  scoreDeck,
  type DeckScore,
  type DeckScoreMetrics,
  type OptimizeOptions,
  type OptimizeResult,
  type OptimizedSwap,
  type OptimizerCard,
  type ScoreDeckContext,
} from "./domain/optimize";
export {
  rateCard,
  strength,
  type CardRating,
  type PowerTier,
  type RatingCandidate,
  type RatingOptions,
  type RatingPart,
  type RatingProfile,
  type RatingWeights,
  type RoleGap,
} from "./domain/rate";
export {
  rankBudgetReplacements,
  type BudgetReplacement,
  type BudgetReplacementOptions,
  type ReplacementCandidate,
} from "./domain/replacements";
export { deckSignalProfile } from "./domain/signals";
export {
  budgetPicks,
  deckProfile,
  plural,
  rank,
  scoreForDeck,
  scoreForRole,
  scoreLike,
  type CandidateCard,
  type DeckFingerprint,
  type Reason,
  type Scored,
} from "./domain/suggest";
export {
  suggestSwaps,
  type SwapCutMeta,
  type SwapOptions,
  type SwapReason,
  type SwapSuggestion,
} from "./domain/swaps";
