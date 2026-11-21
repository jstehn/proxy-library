// The pure code of decks/scoring that the other areas, the module root and the browser use (ADR 0016, 0029).
export { rankCuts, type CutReason } from "./domain/cuts";
export {
  lineToOptimizerCard,
  optimizeDeck,
  scoreDeck,
  type DeckScore,
  type OptimizeResult,
  type OptimizerCard,
} from "./domain/optimize";
export { rateCard, strength, type CardRating, type RoleGap } from "./domain/rate";
export { rankBudgetReplacements } from "./domain/replacements";
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
export { suggestSwaps, type SwapCutMeta, type SwapReason } from "./domain/swaps";
