// The decks module's public API: the only file other modules and the app may import.
export { deleteAllDecks } from "./application/delete-all-decks";
export { makeDecks, type Decks } from "./application/make-decks";
export {
  makeDeckSharing,
  type DeckSharing,
  type DeleteCommentError,
  type PostCommentError,
  type SetVisibilityError,
} from "./application/sharing";
export {
  canViewDeck,
  CommentId,
  MAX_COMMENT_LENGTH,
  VISIBILITIES,
  type Visibility,
} from "./domain/sharing";
export {
  createDeckInTransaction,
  type DeckCardInput,
  type NewDeckInput,
} from "./application/create-deck-in-transaction";
export type {
  ApplyChangesError,
  ApplyChangesInput,
  ApplyChangesReport,
  ChoosePrintingError,
  ChoosePrintingInput,
  CreateDeckError,
  DeleteSnapshotError,
  ImportReport,
  OrderHeadingsError,
  RenameHeadingError,
  RenameHeadingInput,
  ReplaceListError,
  ReplaceListInput,
  ReplaceReport,
  RestoreSnapshotError,
  SaveSnapshotError,
  SetEntryError,
  SetEntryHeadingError,
  SetEntryHeadingInput,
  SetEntryInput,
  SetEntryNoteError,
  SetEntryNoteInput,
  UpdateDeckError,
} from "./application/manage-decks";
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
  COUNTED_BOARDS,
  DeckId,
  DeckOrigin,
  isCounted,
  isPlayed,
  FORMATS,
  GROUPINGS,
  MAX_LIST_LINES,
  MAX_QUANTITY,
  type Board,
  type CountedBoard,
  type Deck,
  type Format,
  type Grouping,
} from "./domain/deck";
export { checkHeading, MAX_HEADING_LENGTH, MAX_HEADINGS } from "./domain/headings";
export { checkNote, MAX_NOTE_LENGTH } from "./domain/notes";
export {
  checkSnapshotLabel,
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
  canBeCommander,
  CONSTRUCTED_60_FORMATS,
  copyLimitFor,
  deckProblems,
  formatRulesSummary,
  invalidCommanders,
  legalFormatsForCards,
  pairProblem,
  shortCount,
  type CardRules,
  type DeckProblem,
  type FormatRulesSummary,
} from "./domain/rules";
export {
  COMMANDER_ROLE_TARGETS,
  deckStats,
  isLand,
  mainType,
  roleTargets,
  SIXTY_CARD_ROLE_TARGETS,
  TYPE_ORDER,
  type DeckStats,
} from "./domain/stats";
export {
  BRACKET_NAMES,
  BRACKET_RULES,
  BRACKETS,
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  type BracketRuleReason,
  estimateBracket,
  fitsTarget,
  flagsOverTarget,
  isBracket,
  type Bracket,
  type BracketEstimate,
  type BracketFinding,
  type BracketLine,
  type BracketRule,
  type BracketSource,
  type BracketWarning,
  type DeckCombo,
} from "./domain/brackets";
export { combosForDeck } from "./queries/combos";
export {
  decksUsing,
  deckView,
  decksFor,
  type DeckRef,
  preconCommanders,
  type PreconCommanders,
  type DeckLine,
  type DeckSummary,
  type DeckView,
  otherDecksHolding,
  type OtherDeckUse,
} from "./queries/decks";
export { copiesToTake, takeCopies, type BoardCount } from "./domain/free-copies";
export {
  rankCuts,
  type CutContext,
  type CutLine,
  type CutReason,
  type RankedCut,
} from "./domain/cuts";
export {
  suggestSwaps,
  type SwapCutMeta,
  type SwapOptions,
  type SwapReason,
  type SwapSuggestion,
} from "./domain/swaps";
export {
  optimizeDeck,
  scoreDeck,
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
  type SampleHand,
  type SimulateHandsOptions,
} from "./domain/goldfish";
export {
  auditDeck,
  type AuditFinding,
  type AuditRoleStatus,
  type DeckAuditReport,
} from "./queries/audit";
export {
  rateCard,
  weightsForBracket,
  powerTierForBracket,
  type CardRating,
  type PowerTier,
  type RatingProfile,
} from "./domain/rate";
export { deckSignalProfile } from "./domain/signals";
export { deckProfile } from "./domain/suggest";
export {
  BROWSE_PAGE_SIZE,
  BROWSE_SORTS,
  browseCollection,
  deckBrowseContext,
  type BrowseCard,
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
  BUDGET_LIST_MAXIMUM,
  budgetList,
  budgetReplacements,
  deckSuggestions,
  similarCards,
  type BudgetList,
  type BudgetReplacementPick,
  type BudgetReplacementsResult,
  type DeckSuggestions,
  type ExpensiveCardReplacements,
  type Suggestion,
  type SuggestionCard,
  type SuggestionList,
} from "./queries/suggestions";
export { embedSimForCards } from "./queries/embeddings";
export {
  semanticSearchForDeck,
  type SemanticSearchPick,
  type SemanticSearchResult,
} from "./queries/semantic-search";
export { deckCombosView, type DeckCombosView, type OneCardAwayCombo } from "./queries/deck-combos";
export {
  rankBudgetReplacements,
  type BudgetReplacement,
  type BudgetReplacementOptions,
  type ReplacementCandidate,
} from "./domain/replacements";
export type { DeckProfile, Reason } from "./domain/suggest";
export { manaBasePlan } from "./queries/mana-base";
export { draftForDeck } from "./queries/draft-deck";
export {
  planPackageInsert,
  type PackageEntrySpec,
  type PackageInsertItem,
  type PackageInsertPlan,
  type PackageSkipReason,
} from "./domain/packages";
export {
  listCardPackages,
  createCardPackage,
  applyCardPackageToDeck,
  type CardPackageSummary,
} from "./queries/packages";
export {
  curveBucket,
  draftDeck,
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
  commanderPowerScore,
  popularityBonus,
  rankCommanders,
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
  deckSignalCards,
  findCard,
  ownedSignalCards,
  SIGNAL_CARD_LIMIT,
  type CardReference,
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
  PAPER_SIZES,
  proxyPages,
  proxySummary,
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
  deckTokens,
  filterTokenChecklist,
  sheetCards,
  summarizeTokenChecklist,
  TOKEN_KINDS,
  tokenDescription,
  tokenKind,
  tokenRulesText,
  tokensToPrint,
  toTokenChecklistItem,
  type TokenArt,
  type TokenChecklistItem,
  type TokenChecklistSummary,
  type TokenKind,
  type TokenLine,
  type TokenMaker,
} from "./domain/token-proxies";
export {
  compareDeckStates,
  previewChanges,
  problemKey,
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
  chanceByTurn,
  deckOdds,
  EARLY_RAMP_MAX_MV,
  hypergeometricAtLeast,
  hypergeometricAtLeast2Groups,
  library,
  nextHand,
  OPENING_HAND,
  openingHandOdds,
  startHand,
  type DrawLine,
  type LandDropOdds,
  type LibraryCard,
  type OddsRow,
  type OpeningHandOdds,
  type TestHand,
  type TestHandEvent,
} from "./domain/draws";
export {
  buildUpgradeRoadmap,
  DEFAULT_UPGRADE_TIERS_CENTS,
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
