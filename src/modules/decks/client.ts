// The decks module's browser-safe public API (ADR 0016): pure domain code for client components.
// Server code imports index.ts instead.
export {
  TARGETED_TAGS,
  type TargetedTag,
  deckStats,
  isLand,
  mainType,
  TYPE_ORDER,
  type DeckStats,
  type ManaSource,
  type StatsLine,
} from "./domain/stats";
export {
  formatRules,
  type DeckSize,
  type FormatRuleSet,
  type RoleTargets,
} from "./domain/format-rules";
export { problemsOfLines } from "./domain/deck-reads";
export { deckProfile } from "./domain/suggest";
export { deckSignalProfile } from "./domain/signals";
export {
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  pageList,
  proxySummary,
  TOKEN_COPIES,
  type ProxyLine,
  type ProxyOptions,
  type ProxySummary,
} from "./domain/proxy-sheet";
export {
  filterTokenChecklist,
  sheetCards,
  summarizeTokenChecklist,
  tokenDescription,
  toTokenChecklistItem,
  type TokenArt,
  type TokenChecklistItem,
  type TokenChecklistSummary,
  type TokenKind,
  type TokenLine,
} from "./domain/token-proxies";
export { proxyPages, cardsToPrint } from "./domain/proxy-sheet";
export {
  completeLines,
  progressFraction,
  progressLabel,
  type ProxyProgress,
  type ProxyStreamEvent,
} from "./domain/proxy-progress";
export { copiesToTake } from "./domain/free-copies";
export { landTarget } from "./domain/mana-base";
export {
  rankCuts,
  type CutContext,
  type CutLine,
  type CutReason,
  type CutWeights,
  type RankedCut,
} from "./domain/cuts";
export {
  rateCard,
  type CardRating,
  type PowerTier,
  type RatingCandidate,
  type RatingOptions,
  type RatingPart,
  type RatingProfile,
  type RatingWeights,
} from "./domain/rate";
export {
  suggestSwaps,
  type SwapCutMeta,
  type SwapOptions,
  type SwapReason,
  type SwapSuggestion,
} from "./domain/swaps";
export {
  type DeckScore,
  type DeckScoreMetrics,
  type OptimizedSwap,
  type OptimizeOptions,
  type OptimizeResult,
  type OptimizerCard,
  type ScoreDeckContext,
} from "./domain/optimize";
export {
  type BudgetReplacement,
  type BudgetReplacementOptions,
  type ReplacementCandidate,
} from "./domain/replacements";
export { BOARDS, isCounted, type DeckCount } from "./domain/boards";
export {
  copyLimitFor,
  deckProblems,
  type CardRules,
  type DeckProblem,
  type DeckToCheck,
} from "./domain/rules";
export {
  openingHandOdds,
  type LandDropOdds,
  type OddsRow,
  type OpeningHandOdds,
} from "./domain/draws";
export { dealHand, nextHand, type HandState, type TestHandEvent } from "./domain/opening-hand/hand";
export {
  EARLY_RAMP_MAX_MV,
  library,
  type DrawLine,
  type LibraryCard,
} from "./domain/opening-hand/library";
export { type GoldfishReport, type SampleHand, type SimulateHandsOptions } from "./domain/goldfish";
export { plural, type Reason } from "./domain/suggest";
export {
  BRACKET_NAMES,
  BRACKETS,
  bracketLine,
  bracketWarning,
  estimateBracket,
  type Bracket,
  type BracketEstimate,
  type BracketFinding,
  type BracketLine,
  type BracketRule,
  type BracketWarning,
  type DeckCombo,
} from "./domain/brackets";
export { headingMoved, MAX_HEADING_LENGTH } from "./domain/headings";
export { checkNote, MAX_NOTE_LENGTH } from "./domain/notes";
export { MAX_ROLE_LENGTH, tidyRole } from "./domain/deck";
export {
  checkSnapshotLabel,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
} from "./domain/snapshots";
export {
  EMPTY_DECK_PROFILE,
  type AvoidCard,
  type DeckPlan,
  type KeyCardPin,
} from "./domain/deck-profile";
