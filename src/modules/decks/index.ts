// The decks module's public API: the only file other modules and the app may import.
export { deleteAllDecks } from "./application/delete-all-decks";
export { makeDecks, type Decks } from "./application/make-decks";
export { makeListDecks, type DeckListing } from "./application/list-decks";
export {
  makeDeckSharing,
  type DeckSharing,
  type DeleteCommentError,
  type PostCommentError,
  type SetVisibilityError,
} from "./application/sharing";
export { CommentId, MAX_COMMENT_LENGTH, VISIBILITIES, type Visibility } from "./domain/sharing";
export {
  createDeckInTransaction,
  type DeckCardInput,
  type NewDeckInput,
} from "./application/create-deck-in-transaction";
export type {
  ApplyChangesError,
  ApplyChangesInput,
  ApplyChangesReport,
  SetEntryError,
  SetEntryInput,
  SetEntryNoteError,
  SetEntryNoteInput,
} from "./application/deck-entries";
export type { ChoosePrintingError, ChoosePrintingInput } from "./application/deck-printings";
export type { CreateDeckError, UpdateDeckError } from "./application/deck-lifecycle";
export type {
  DeleteSnapshotError,
  RestoreSnapshotError,
  SaveSnapshotError,
} from "./application/deck-snapshots";
export type {
  ImportReport,
  ReplaceListError,
  ReplaceListInput,
  ReplaceReport,
} from "./application/deck-lists";
export type {
  OrderHeadingsError,
  RenameHeadingError,
  RenameHeadingInput,
  SetEntryHeadingError,
  SetEntryHeadingInput,
} from "./application/deck-headings";
export type {
  CardLookup,
  DeckRepository,
  DeckSharingRepository,
  DeckSharingServices,
  DeckTokenRepository,
  TokenChoiceServices,
  DecksDependencies,
  DecksServices,
} from "./application/ports";
export {
  becomesADeck,
  BOARDS,
  DeckId,
  CORE_DECK_TAGS,
  isPlayed,
  FORMATS,
  GROUPINGS,
  MAX_QUANTITY,
  type Board,
  type CountedBoard,
  type Deck,
  type Format,
  type Grouping,
} from "./domain/deck";
export type { ManaBasePlanWithCastability } from "./domain/mana-base";
export { makeFindReplacements, type SimilarCards } from "./application/find-replacements";
export { makeDeckFacts, type DeckFacts } from "./application/deck-facts";
export { makeDeckManaPlan } from "./application/deck-mana-plan";
export {
  makeDeckSignals,
  makeSearchSignals,
  type DeckSignals,
  type SearchSignals,
} from "./application/deck-signals";
export { makeDeckSearch } from "./application/deck-search";
export {
  makeDeckOverview,
  type DeckOverview,
  type DeckOverviewReaders,
  type OverviewParts,
} from "./application/deck-overview";
export {
  bracketReport,
  listAndFingerprint,
  problemsOfLines,
  type BracketReport,
} from "./domain/deck-reads";
export { describeDeckError, type DeckError } from "./application/describe-error";
export { MAX_HEADING_LENGTH, MAX_HEADINGS } from "./domain/headings";
export { checkNote, MAX_NOTE_LENGTH } from "./domain/notes";
export { MAX_ROLE_LENGTH } from "./domain/deck";
export {
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
  SnapshotId,
  type DeckSnapshot,
  type SnapshotEntry,
  type SnapshotSummary,
} from "./domain/snapshots";
export type {
  CardNotFound,
  CommentInvalid,
  CommentNotFound,
  DeckChanged,
  DeckNotFound,
  EntryNotFound,
  FinishNotAvailable,
  HeadingInvalid,
  HeadingNotFound,
  HeadingOrderInvalid,
  ListProblems,
  ListTooLong,
  NotAllowed,
  NameInvalid,
  NoteInvalid,
  PrintingNotOfCard,
  QuantityInvalid,
  SnapshotLabelInvalid,
  SnapshotNotFound,
  TooManyDecks,
  TooManyHeadings,
  TooManySnapshots,
} from "./domain/errors";
export {
  deckText,
  EXPORTERS,
  exportWithHeadings,
  fingerprint,
  shortList,
  type DeckTextLine,
  type ExportLine,
  type FingerprintEntry,
  type ShortLine,
} from "./domain/list-format";
export {
  deckProblems,
  formatRulesSummary,
  invalidCommanders,
  legalFormatsForCards,
  pairProblem,
  type CardRules,
  type DeckProblem,
  type FormatRulesSummary,
} from "./domain/rules";
export { colorPips, deckStats, roleTargets, type DeckStats } from "./domain/stats";
export {
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  type BracketRuleReason,
  estimateBracket,
  type Bracket,
  type BracketEstimate,
  type BracketFinding,
  type BracketLine,
  type BracketRule,
  type BracketSource,
  type BracketWarning,
  type DeckCombo,
} from "./domain/brackets";
export { cheapestForSale, cheapestOfCards, notOwned, ownedPerCard } from "./queries/candidate-pool";
export { combosForDeck } from "./queries/combos";
export {
  addDeckSource,
  decksUsing,
  listDeckSources,
  deckView,
  decksFor,
  type DeckRef,
  preconCommanders,
  type PreconCommanders,
  type DeckSummary,
  otherDecksHolding,
} from "./queries/decks";
export type {
  DeckLine,
  DeckSource,
  DeckView,
  OtherDeckUse,
  StoredDeckProfile,
} from "./domain/deck-view";
export { takeCopies, type BoardCount } from "./domain/free-copies";
export { type CutContext, type CutLine, type CutReason, type RankedCut } from "./domain/cuts";
export {
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
  optimizeDeckForView,
  type OptimizeDeckPool,
  type OptimizeDeckQueryOptions,
  type OptimizeDeckViewResult,
} from "./queries/optimize";
export {
  simulateOpeningHands,
  type GoldfishReport,
  type MustCastByOption,
  type SampleHand,
  type SimulateHandsOptions,
} from "./domain/goldfish";
export { auditDeck, auditDeckView } from "./queries/audit";
export type { AuditFinding, AuditRoleStatus, DeckAuditReport } from "./domain/audit-report";
export { type CardRating, type PowerTier, type RatingProfile } from "./domain/rate";
export {
  BROWSE_SORTS,
  browseCollection,
  type BrowseInput,
  type BrowsePage,
  type BrowseSort,
  BROWSE_SOURCES,
  type BrowseSource,
} from "./queries/browse";
export {
  cardPrintings,
  type PrintingFinish,
  type PrintingFinishOption,
  type PrintingOption,
} from "./queries/printings";
export {
  budgetList,
  deckSuggestions,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
} from "./queries/suggestions";
export { budgetReplacements } from "./queries/budget-replacements";
export type { BrowseCard } from "./domain/browse-card";
export type {
  BudgetReplacementPick,
  BudgetReplacementsResult,
  ExpensiveCardReplacements,
} from "./domain/suggestion-types";
export {
  type Suggestion,
  type SuggestionCard,
  type SuggestionList,
} from "./domain/suggestion-types";
export { embedSimForCards } from "./queries/embeddings";
export {
  semanticSearchForDeck,
  type SemanticSearchPick,
  type SemanticSearchResult,
} from "./queries/semantic-search";
export { deckCombosView, type DeckCombosView, type OneCardAwayCombo } from "./queries/deck-combos";
export {
  type BudgetReplacement,
  type BudgetReplacementOptions,
  type ReplacementCandidate,
} from "./domain/replacements";
export type { DeckFingerprint, Reason } from "./domain/suggest";
export { manaBasePlan } from "./queries/mana-base";
export { draftForDeck } from "./queries/draft-deck";
export {
  type PackageEntrySpec,
  type PackageInsertItem,
  type PackageInsertPlan,
  type PackageSkipReason,
} from "./domain/packages";
export { type CardPackageSummary } from "./queries/packages";
export {
  type MulliganChoice,
  type MulliganDrill,
  type MulliganDrillOptions,
  type MulliganEvaluation,
} from "./domain/mulligan-trainer";
export { publicDeckScorecard, type PublicDeckScorecard } from "./queries/scorecard";
export {
  type CurveBucket,
  type DeckDraft,
  type DraftCandidate,
  type DraftedSpell,
  type DraftInput,
  type DraftOptions,
  type DraftReason,
  type DraftSection,
  type RoleProgress,
} from "./domain/draft-deck";
export {
  commanderDetails,
  commandersICanBuild,
  type CommanderDetails,
  type CommanderSearch,
} from "./queries/commanders";
export {
  COMMANDER_SORTS,
  SPELL_SLOTS,
  type CommanderSort,
  type RankCommandersOptions,
} from "./domain/commanders";
export type {
  CommanderCandidate,
  CommanderCoverage,
  CommanderPlan,
  MissingCost,
  MissingPick,
  PoolCard,
  RoleCoverage,
} from "./domain/commanders";
export type {
  LandCandidate,
  LandReason,
  LandTarget,
  LandTargetReason,
  ManaBasePlan,
  PlannedLand,
  SourceTarget,
  Tapped,
} from "./domain/mana-base";
export {
  cardsToGetFor,
  deckComments,
  deckForViewer,
  publicDeckByToken,
  sharedDecks,
  type CardsToGet,
  type CardToGetView,
  type CommentView,
  type PublicDeck,
  type SharedDeck,
  type ViewedDeck,
} from "./queries/sharing";
export {
  checkOwnedCards,
  deckSignalCards,
  findCard,
  ownedSignalCards,
  type CardReference,
  type OwnedCardCheck,
} from "./queries/card-facts";
export {
  searchForDeck,
  type SearchForDeck,
  type SearchForDeckInput,
} from "./queries/search-for-deck";
export {
  SEARCH_FOR_DECK_LIMITS,
  SEARCH_POOLS,
  type MergedCard,
  type QueryReport,
  type SearchPool,
  type SynergyQuery,
} from "./domain/search-for-deck";
export { makeProxySheets, type ProxySheet, type ProxySheetInput } from "./application/proxy-sheets";
export type {
  ProxyImageSource,
  ProxyPdfRenderer,
  ProxySheetsDependencies,
} from "./application/ports";
export {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  TOKEN_COPIES,
  type ProxyLine,
  type ProxyOptions,
} from "./domain/proxy-sheet";
export {
  makeTokenChoices,
  type ChooseToken,
  type ChooseTokenError,
  type ChooseTokenInput,
} from "./application/token-choices";
export { deckTokenLines, tokenArtOptions } from "./queries/tokens";
export {
  filterTokenChecklist,
  summarizeTokenChecklist,
  toTokenChecklistItem,
  type TokenArt,
  type TokenChecklistItem,
  type TokenChecklistSummary,
  type TokenKind,
  type TokenLine,
  type TokenMaker,
} from "./domain/token-proxies";
export {
  type AppliedChange,
  type ChangePreview,
  type DeckChange,
  type PreviewLine,
  type PreviewSnapshot,
  type RoleDelta,
} from "./domain/preview";
export {
  deckChangePreview,
  deckListPreview,
  type DeckChangePreview,
  type ListPreviewError,
  type ListPreviewResult,
} from "./queries/preview";
export {
  compareDeckSnapshot,
  listDeckSnapshots,
  type SnapshotComparison,
  type SnapshotComparisonSide,
} from "./queries/snapshots";
export type { ProxyProgress, ProxyStreamEvent } from "./domain/proxy-progress";
export {
  library,
  openingHandOdds,
  type DrawLine,
  type LandDropOdds,
  type LibraryCard,
  type OddsRow,
  type OpeningHandOdds,
  type TestHand,
  type TestHandEvent,
} from "./domain/draws";
export {
  type BuildUpgradeRoadmapInput,
  type UpgradeCandidate,
  type UpgradeCut,
  type UpgradeRoadmap,
  type UpgradeSwap,
  type UpgradeTierPlan,
} from "./domain/upgrade-roadmap";
export {
  deckUpgradeRoadmap,
  type UpgradeRoadmapOptions,
  type UpgradeRoadmapResult,
} from "./queries/upgrade-roadmap";
export {
  makeGoldfishSessions,
  type GoldfishSessionError,
  type GoldfishSessionResult,
  type GoldfishSessions,
  type GoldfishStepInput,
} from "./application/goldfish-sessions";
export {
  type BattlefieldPermanent,
  type GoldfishAction,
  type GoldfishCard,
  type GoldfishDeckLine,
  type GoldfishError,
  type GoldfishState,
  type GoldfishZone,
} from "./domain/goldfish-session";
export {
  commanderOnlyProfile,
  effectiveManaValue,
  declaredComboFor,
  isAvoidCard,
  withoutAvoidCards,
  type AvoidSplit,
  COST_REDUCER_SCOPES,
  isKeyCard,
  primerSections,
  resolveDeckProfileTargets,
  summarizeDeckProfile,
  type AvoidCard,
  type CostReducer,
  type CostReducerScope,
  type DeckPlan,
  type EdhrecProfileFallback,
  type FixedCardRoleTag,
  type KeyCardPin,
  type RoleTargetKey,
} from "./domain/deck-profile";
export { getDeckProfile, updateDeckPrimer, updateDeckProfile } from "./queries/deck-profile";
export {
  makeDeckPreviews,
  PREVIEW_TTL_MS,
  type ApplyPreviewError,
  type ChangeNoteInvalid,
  type ChangeRequest,
  type CardsNotFound,
  type LineNotOnBoard,
  type PreviewChangesError,
  type PreviewExpired,
  type PreviewWarning,
  type PreviewedChanges,
  type SaveChangesError,
  type SavedChanges,
  type StoredPreviewResult,
} from "./application/deck-previews";
export type { ChangeToSave, PreviewRecord, PreviewRepository } from "./application/ports";
export {
  makeDeckPlanEdits,
  type DeckPlanWriters,
  type SavedSource,
} from "./application/deck-plan-edits";
export { makeStartDeck, type StartDeckInput, type StartedDeck } from "./application/deck-start";
export {
  makeEdhrecResearch,
  type CommanderMissing,
  type EdhrecDeckComparison,
  type EdhrecNotFound,
  type EdhrecUnavailable,
} from "./application/deck-edhrec";
export {
  makeDeckCombos,
  type DeckCombos,
  type SpellbookUnavailable,
} from "./application/deck-combos";
export { makeDrawSample, type DeckTooSmall, type DrawSample } from "./application/draw-sample";
