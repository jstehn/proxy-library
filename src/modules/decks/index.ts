// The decks module's public API: the only file other modules and the app may import.
export { deleteAllDecks } from "./application/delete-all-decks";
export type { ProxyDeck } from "@/modules/decks/proxies";
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
export type { ManaBasePlanWithCastability } from "@/modules/decks/building/client";
export { type SimilarCards } from "@/modules/decks/building";
export { type DeckFacts } from "@/modules/decks/overview";

export { type DeckSignals, type SearchSignals } from "@/modules/decks/scoring";

export { type DeckOverview, type OverviewParts } from "@/modules/decks/overview";
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
export { cheapestForSale, cheapestOfCards, notOwned, ownedPerCard } from "@/modules/decks/building";
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

export { type CutReason } from "@/modules/decks/scoring/client";
export { type SwapCutMeta, type SwapReason } from "@/modules/decks/scoring/client";
export { type OptimizeResult } from "@/modules/decks/scoring/client";
export { optimizeDeckForView, type OptimizeDeckPool } from "@/modules/decks/building";

export { auditDeck } from "@/modules/decks/building";

export { type PowerTier } from "@/modules/decks/scoring/client";
export {
  BROWSE_SORTS,
  browseCollection,
  type BrowseInput,
  type BrowsePage,
  type BrowseSort,
  BROWSE_SOURCES,
  type BrowseSource,
} from "@/modules/decks/building";
export { cardPrintings, type PrintingFinish, type PrintingOption } from "./queries/printings";
export {
  budgetList,
  deckSuggestions,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
} from "./queries/suggestions";
export { budgetReplacements } from "./queries/budget-replacements";
export type { BrowseCard } from "@/modules/decks/building/client";
export type { BudgetReplacementsResult } from "@/modules/decks/building/client";
export {
  type Suggestion,
  type SuggestionCard,
  type SuggestionList,
} from "@/modules/decks/building/client";
export { embedSimForCards } from "@/modules/decks/building";
export { semanticSearchForDeck, type SemanticSearchResult } from "@/modules/decks/building";

export type { Reason } from "@/modules/decks/scoring/client";
export { manaBasePlan } from "@/modules/decks/building";
export { draftForDeck } from "@/modules/decks/building";

export {
  type DeckDraft,
  type DraftedSpell,
  type DraftReason,
} from "@/modules/decks/building/client";
export { commanderDetails, commandersICanBuild } from "@/modules/decks/building";
export { COMMANDER_SORTS, SPELL_SLOTS, type CommanderSort } from "@/modules/decks/building/client";
export type { CommanderCoverage, CommanderPlan } from "@/modules/decks/building/client";
export type {
  LandReason,
  LandTargetReason,
  ManaBasePlan,
  PlannedLand,
} from "@/modules/decks/building/client";
export { canViewDeck } from "./domain/sharing";
export { cardsToGetFor, type CommentView } from "./queries/sharing";
export { deckQueries, deckPublicQueries } from "@/modules/decks/overview";
export { checkOwnedCards, findCard } from "@/modules/decks/scoring";
export { searchForDeck, type SearchForDeck } from "@/modules/decks/building";
export { type SynergyQuery } from "@/modules/decks/building/client";
export { makeProxySheets, type ProxySheetInput } from "@/modules/decks/proxies";

export {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  TOKEN_COPIES,
  type ProxyLine,
  type ProxyOptions,
} from "@/modules/decks/proxies/client";
export { makeTokenChoices, type ChooseTokenInput } from "@/modules/decks/proxies";
export { deckTokenLines } from "@/modules/decks/proxies";
export {
  filterTokenChecklist,
  summarizeTokenChecklist,
  toTokenChecklistItem,
  type TokenArt,
  type TokenChecklistItem,
  type TokenKind,
  type TokenLine,
  type TokenMaker,
} from "@/modules/decks/proxies/client";

export { deckChangePreview, deckListPreview, type DeckChangePreview } from "./queries/preview";
export {
  compareDeckSnapshot,
  listDeckSnapshots,
  type SnapshotComparison,
} from "@/modules/decks/overview";
export type { ProxyProgress, ProxyStreamEvent } from "@/modules/decks/proxies/client";
export { openingHandOdds } from "@/modules/decks/play/client";
export { library, type LibraryCard } from "@/modules/decks/play/client";

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
export { type CastReport, type DeckTooSmall } from "@/modules/decks/play";
