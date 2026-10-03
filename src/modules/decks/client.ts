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
  type ProxyLine,
  type ProxyOptions,
  type ProxySummary,
} from "./domain/proxy-sheet";
export { proxyPages, cardsToPrint } from "./domain/proxy-sheet";
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
