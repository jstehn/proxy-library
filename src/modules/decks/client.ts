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
export { deckProfile } from "@/modules/decks/scoring/client";
export { deckSignalProfile } from "@/modules/decks/scoring/client";
export {
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  pageList,
  proxySummary,
  TOKEN_COPIES,
  type ProxyLine,
  type ProxyOptions,
  type ProxySummary,
} from "@/modules/decks/proxies/client";
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
} from "@/modules/decks/proxies/client";
export { proxyPages, cardsToPrint } from "@/modules/decks/proxies/client";
export {
  completeLines,
  progressFraction,
  progressLabel,
  type ProxyProgress,
  type ProxyStreamEvent,
} from "@/modules/decks/proxies/client";
export { copiesToTake } from "./domain/free-copies";
export { landTarget } from "./domain/mana-base";
export {
  rankCuts,
  type CutContext,
  type CutLine,
  type CutReason,
  type RankedCut,
} from "@/modules/decks/scoring/client";
export {
  rateCard,
  type CardRating,
  type PowerTier,
  type RatingCandidate,
  type RatingOptions,
  type RatingPart,
  type RatingProfile,
  type RatingWeights,
} from "@/modules/decks/scoring/client";
export {
  suggestSwaps,
  type SwapCutMeta,
  type SwapOptions,
  type SwapReason,
  type SwapSuggestion,
} from "@/modules/decks/scoring/client";
export {
  type DeckScore,
  type DeckScoreMetrics,
  type OptimizedSwap,
  type OptimizeOptions,
  type OptimizeResult,
  type OptimizerCard,
  type ScoreDeckContext,
} from "@/modules/decks/scoring/client";
export {
  type BudgetReplacement,
  type BudgetReplacementOptions,
  type ReplacementCandidate,
} from "@/modules/decks/scoring/client";
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
} from "@/modules/decks/play/client";
export {
  dealHand,
  nextHand,
  type HandState,
  type TestHandEvent,
} from "@/modules/decks/play/client";
export {
  EARLY_RAMP_MAX_MV,
  library,
  type DrawLine,
  type LibraryCard,
} from "@/modules/decks/play/client";
export {
  type GoldfishReport,
  type SampleHand,
  type SimulateHandsOptions,
} from "@/modules/decks/play/client";
export { plural, type Reason } from "@/modules/decks/scoring/client";
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
