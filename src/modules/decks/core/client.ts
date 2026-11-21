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
  type BracketWarning,
  type DeckCombo,
} from "./domain/brackets";
export {
  DeckId,
  FORMATS,
  GROUPINGS,
  MAX_ROLE_LENGTH,
  becomesADeck,
  tidyRole,
  type Deck,
  type Format,
  type Grouping,
} from "./domain/deck";
export {
  EMPTY_DECK_PROFILE,
  commanderOnlyProfile,
  effectiveManaValue,
  isAvoidCard,
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
} from "./domain/deck-reads";
export type {
  DeckLine,
  DeckSource,
  DeckView,
  OtherDeckUse,
  StoredDeckProfile,
} from "./domain/deck-view";
export type {
  CardNotFound,
  DeckNotFound,
  NotThatToken,
  TokenNotInDeck,
  TooManyDecks,
} from "./domain/errors";
export { FORMAT_RULES, formatRules } from "./domain/format-rules";
export { copiesToTake } from "./domain/free-copies";
export { MAX_HEADINGS, MAX_HEADING_LENGTH, headingMoved } from "./domain/headings";
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
} from "./domain/mana-payment";
export {
  colorsOfCost,
  costSymbols,
  splitSymbols,
  symbolArt,
  type SymbolArt,
} from "./domain/mana-symbols";
export { MAX_NOTE_LENGTH, checkNote } from "./domain/notes";
export type { OwnedCardCheck } from "./domain/owned-card-check";
export { compareDeckStates, type ChangePreview, type PreviewLine } from "./domain/preview";
export {
  canBeCommander,
  copyLimitFor,
  deckProblems,
  invalidCommanders,
  legalFormatsForCards,
  pairProblem,
  type CardRules,
  type DeckProblem,
} from "./domain/rules";
export {
  CommentId,
  MAX_COMMENT_LENGTH,
  VISIBILITIES,
  canViewDeck,
  isValidPublicToken,
} from "./domain/sharing";
export {
  MAX_SNAPSHOTS_PER_DECK,
  MAX_SNAPSHOT_LABEL_LENGTH,
  SnapshotId,
  checkSnapshotLabel,
  type SnapshotSummary,
} from "./domain/snapshots";
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
