// The decks module's browser-safe public API (ADR 0016): pure domain code for client components.
// Server code imports index.ts instead.
export {
  colorPips,
  roleTargets,
  TARGETED_TAGS,
  type TargetedTag,
  deckSize,
  deckStats,
  isLand,
  MANA_COLORS,
  mainType,
  suggestedLands,
  TYPE_ORDER,
  type DeckStats,
  type ManaColor,
  type ManaSource,
  type StatsLine,
} from "./domain/stats";
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
  sheetCards,
  tokenDescription,
  type TokenArt,
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
export { landTarget, tapped } from "./domain/mana-base";
export {
  CUT_WEIGHTS,
  rankCuts,
  type CutContext,
  type CutLine,
  type CutReason,
  type RankedCut,
} from "./domain/cuts";
export { BOARDS, COUNTED_BOARDS, isCounted, isPlayed, type Board } from "./domain/boards";
export {
  deckProblems,
  canBeCommander,
  type CardRules,
  type DeckProblem,
  type DeckToCheck,
} from "./domain/rules";
export {
  deckOdds,
  hypergeometricAtLeast,
  library,
  nextHand,
  OPENING_HAND,
  startHand,
  type DrawLine,
  type LibraryCard,
  type OddsRow,
  type TestHand,
  type TestHandEvent,
} from "./domain/draws";
export { creatureTypes, plural, type Reason } from "./domain/suggest";
export {
  BRACKET_NAMES,
  BRACKET_RULES,
  BRACKETS,
  bracketLine,
  bracketWarning,
  estimateBracket,
  isBracket,
  type Bracket,
  type BracketEstimate,
  type BracketFinding,
  type BracketLine,
  type BracketRule,
  type BracketSource,
  type BracketWarning,
} from "./domain/brackets";
export { checkHeading, headingMoved, MAX_HEADING_LENGTH, MAX_HEADINGS } from "./domain/headings";
