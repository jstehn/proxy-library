// The pure code of decks/core that the other areas, the module root and the browser use (ADR 0016, 0029).
export { BOARDS, isCounted, isPlayed, type Board, type DeckCount } from "./domain/boards";
export {
  BRACKETS,
  BRACKET_NAMES,
  bracketFlagsOf,
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  estimateBracket,
  fitsTarget,
  flagsOverTarget,
  isBracket,
  type Bracket,
  type BracketEstimate,
  type BracketFinding,
  type BracketLine,
  type BracketRule,
  type BracketRuleReason,
  type BracketSource,
  type BracketWarning,
  type DeckCombo,
} from "./domain/brackets";
export {
  DeckId,
  FORMATS,
  GROUPINGS,
  MAX_LIST_LINES,
  MAX_QUANTITY,
  MAX_ROLE_LENGTH,
  VISIBILITIES,
  canViewDeck,
  isValidPublicToken,
  becomesADeck,
  tidyRole,
  type Deck,
  type DeckEntry,
  type Format,
  type Grouping,
  type Visibility,
} from "./domain/deck";
export {
  EMPTY_DECK_PROFILE,
  commanderOnlyProfile,
  effectiveManaValue,
  isAvoidCard,
  declaredComboFor,
  isKeyCard,
  resolveDeckProfileTargets,
  summarizeDeckProfile,
  withoutAvoidCards,
  type DeckPlan,
} from "./domain/deck-profile";
export {
  bracketReport,
  listAndFingerprint,
  problemsOfLines,
  type BracketReport,
} from "./domain/deck-view";
export type {
  DeckLine,
  DeckSource,
  DeckView,
  OtherDeckUse,
  StoredDeckProfile,
} from "./domain/deck-view";
export type {
  CardNotFound,
  CommentInvalid,
  CommentNotFound,
  DeckChanged,
  DeckNotFound,
  HeadingInvalid,
  ListProblems,
  ListTooLong,
  NotAllowed,
  NoteInvalid,
  NotThatToken,
  SnapshotLabelInvalid,
  SnapshotNotFound,
  TooManySnapshots,
  TokenNotInDeck,
  TooManyDecks,
} from "./domain/errors";
export { FORMAT_RULES, formatRules } from "./domain/format-rules";
export { MAX_HEADINGS, MAX_HEADING_LENGTH, headingMoved, tidyHeadings } from "./domain/headings";
export {
  EXPORTERS,
  exportWithHeadings,
  fingerprint,
  shortList,
  type ExportLine,
} from "./domain/list-format";
export {
  canPay,
  firstUnpaidPip,
  isManaSymbol,
  parseCost,
  type ManaSource as PaymentSource,
  type Pip,
} from "./domain/mana";
export { colorsOfCost, costSymbols, splitSymbols, symbolArt, type SymbolArt } from "./domain/mana";
export { MAX_NOTE_LENGTH, checkNote } from "./domain/headings";
export {
  canBeCommander,
  copyLimitFor,
  deckProblems,
  invalidCommanders,
  legalFormatsForCards,
  pairProblem,
  shortCount,
  type CardRules,
  type DeckProblem,
} from "./domain/rules";
export {
  TARGETED_TAGS,
  TYPE_ORDER,
  colorPips,
  deckStats,
  isLand,
  mainType,
  type DeckStats,
  type EdhrecSignal,
  type ManaSource,
  type ProfileLine,
  type StatsLine,
  type TargetedTag,
} from "./domain/stats";
