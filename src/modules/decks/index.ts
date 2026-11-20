// The decks module's public API: the only file other modules and the app may import.
export { deleteAllDecks } from "./application/delete-all-decks";
export type { ProxyDeck } from "./application/proxy-deck";
export { makeDecks, type Decks } from "./application/make-decks";

export { makeDeckSharing, type DeckSharing } from "./application/sharing";
export { CommentId, MAX_COMMENT_LENGTH, VISIBILITIES } from "./domain/sharing";
export {
  createDeckInTransaction,
  type DeckCardInput,
} from "./application/create-deck-in-transaction";

export type { ChoosePrintingInput } from "./application/deck-printings";
export type { UpdateDeckError } from "./application/deck-lifecycle";

export type { ReplaceListError, ReplaceReport } from "./application/deck-lists";

export type { CardLookup, DecksServices } from "./application/ports";
export {
  becomesADeck,
  BOARDS,
  DeckId,
  FORMATS,
  GROUPINGS,
  MAX_QUANTITY,
  type Board,
  type Deck,
  type Format,
  type Grouping,
} from "./domain/deck";
export type { ManaBasePlanWithCastability } from "./domain/mana-base";
export { type SimilarCards } from "./application/find-replacements";
export { type DeckFacts } from "./application/deck-facts";

export { type DeckSignals, type SearchSignals } from "./application/deck-signals";

export { type DeckOverview, type OverviewParts } from "./application/deck-overview";
export { listAndFingerprint, problemsOfLines } from "./domain/deck-reads";
export { describeDeckError, type DeckError } from "./application/describe-error";
export { MAX_HEADING_LENGTH, MAX_HEADINGS } from "./domain/headings";
export { checkNote, MAX_NOTE_LENGTH } from "./domain/notes";
export { MAX_ROLE_LENGTH } from "./domain/deck";
export {
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
  SnapshotId,
  type SnapshotSummary,
} from "./domain/snapshots";
export type {
  CardNotFound,
  CommentNotFound,
  DeckChanged,
  DeckNotFound,
  FinishNotAvailable,
  HeadingInvalid,
  ListProblems,
  ListTooLong,
  NameInvalid,
  NoteInvalid,
  QuantityInvalid,
  TooManyDecks,
} from "./domain/errors";
export {
  EXPORTERS,
  exportWithHeadings,
  fingerprint,
  shortList,
  type ExportLine,
  type ShortLine,
} from "./domain/list-format";
export {
  deckProblems,
  invalidCommanders,
  legalFormatsForCards,
  pairProblem,
  type CardRules,
  type DeckProblem,
} from "./domain/rules";
export { colorPips, deckStats } from "./domain/stats";
export { formatRules, type FormatRuleSet } from "./domain/format-rules";
export {
  bracketLine,
  bracketWarning,
  estimateBracket,
  type Bracket,
  type BracketEstimate,
  type BracketFinding,
  type BracketRule,
  type BracketWarning,
  type DeckCombo,
} from "./domain/brackets";
export { cheapestForSale, cheapestOfCards, notOwned, ownedPerCard } from "./queries/candidate-pool";
export { combosForDeck } from "./queries/combos";
export {
  decksUsing,
  deckView,
  decksFor,
  type DeckRef,
  preconCommanders,
  otherDecksHolding,
} from "./queries/decks";
export type { DeckLine, DeckView, OtherDeckUse } from "./domain/deck-view";

export { type CutReason } from "./domain/cuts";
export { type SwapCutMeta, type SwapReason } from "./domain/swaps";
export { type OptimizeResult } from "./domain/optimize";
export { optimizeDeckForView, type OptimizeDeckPool } from "./queries/optimize";

export { auditDeck } from "./queries/audit";

export { type PowerTier } from "./domain/rate";
export {
  BROWSE_SORTS,
  browseCollection,
  type BrowseInput,
  type BrowsePage,
  type BrowseSort,
  BROWSE_SOURCES,
  type BrowseSource,
} from "./queries/browse";
export { cardPrintings, type PrintingFinish, type PrintingOption } from "./queries/printings";
export {
  budgetList,
  deckSuggestions,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
} from "./queries/suggestions";
export { budgetReplacements } from "./queries/budget-replacements";
export type { BrowseCard } from "./domain/browse-card";
export type { BudgetReplacementsResult } from "./domain/suggestion-types";
export {
  type Suggestion,
  type SuggestionCard,
  type SuggestionList,
} from "./domain/suggestion-types";
export { embedSimForCards } from "./queries/embeddings";
export { semanticSearchForDeck, type SemanticSearchResult } from "./queries/semantic-search";

export type { Reason } from "./domain/suggest";
export { manaBasePlan } from "./queries/mana-base";
export { draftForDeck } from "./queries/draft-deck";

export { type DeckDraft, type DraftedSpell, type DraftReason } from "./domain/draft-deck";
export { commanderDetails, commandersICanBuild } from "./queries/commanders";
export { COMMANDER_SORTS, SPELL_SLOTS, type CommanderSort } from "./domain/commanders";
export type { CommanderCoverage, CommanderPlan } from "./domain/commanders";
export type { LandReason, LandTargetReason, ManaBasePlan, PlannedLand } from "./domain/mana-base";
export { canViewDeck } from "./domain/sharing";
export { cardsToGetFor, type CommentView } from "./queries/sharing";
export * as deckQueries from "./queries";
export * as deckPublicQueries from "./queries/public";
export { checkOwnedCards, findCard } from "./queries/card-facts";
export { searchForDeck, type SearchForDeck } from "./queries/search-for-deck";
export { type SynergyQuery } from "./domain/search-for-deck";
export { makeProxySheets, type ProxySheetInput } from "./application/proxy-sheets";

export {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  TOKEN_COPIES,
  type ProxyLine,
  type ProxyOptions,
} from "./domain/proxy-sheet";
export { makeTokenChoices, type ChooseTokenInput } from "./application/token-choices";
export { deckTokenLines } from "./queries/tokens";
export {
  filterTokenChecklist,
  summarizeTokenChecklist,
  toTokenChecklistItem,
  type TokenArt,
  type TokenChecklistItem,
  type TokenKind,
  type TokenLine,
  type TokenMaker,
} from "./domain/token-proxies";

export { deckChangePreview, deckListPreview, type DeckChangePreview } from "./queries/preview";
export {
  compareDeckSnapshot,
  listDeckSnapshots,
  type SnapshotComparison,
} from "./queries/snapshots";
export type { ProxyProgress, ProxyStreamEvent } from "./domain/proxy-progress";
export { openingHandOdds } from "./domain/draws";
export { library, type LibraryCard } from "./domain/opening-hand/library";

export {
  isKeyCard,
  resolveDeckProfileTargets,
  summarizeDeckProfile,
  type DeckPlan,
} from "./domain/deck-profile";

export {
  type ApplyPreviewError,
  type ChangeNoteInvalid,
  type CardsNotFound,
  type LineNotOnBoard,
  type PreviewChangesError,
  type PreviewExpired,
  type PreviewWarning,
  type SaveChangesError,
  type SavedChanges,
  type StoredPreviewResult,
} from "./application/deck-previews";
export type { PreviewRepository } from "./application/ports";

export { type StartedDeck } from "./application/deck-start";
export {
  type CommanderMissing,
  type EdhrecDeckComparison,
  type EdhrecNotFound,
  type EdhrecUnavailable,
} from "./application/deck-edhrec";
export { type DeckCombos, type SpellbookUnavailable } from "./application/deck-combos";
export {
  type CastCardNotInDeck,
  type CastReport,
  type DeckTooSmall,
} from "./application/draw-sample";
