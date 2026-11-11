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
  ChoosePrintingError,
  ChoosePrintingInput,
  CreateDeckError,
  ImportReport,
  OrderHeadingsError,
  RenameHeadingError,
  RenameHeadingInput,
  ReplaceListError,
  ReplaceListInput,
  ReplaceReport,
  SetEntryError,
  SetEntryHeadingError,
  SetEntryHeadingInput,
  SetEntryInput,
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
  PrintingNotOfCard,
  QuantityInvalid,
  TooManyDecks,
  TooManyHeadings,
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
  deckProblems,
  invalidCommanders,
  shortCount,
  type CardRules,
  type DeckProblem,
} from "./domain/rules";
export { deckStats, mainType, roleTargets, TYPE_ORDER, type DeckStats } from "./domain/stats";
export {
  BRACKET_NAMES,
  BRACKET_RULES,
  BRACKETS,
  bracketLine,
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
  type BracketSource,
  type BracketWarning,
} from "./domain/brackets";
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
  deckSuggestions,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
  type Suggestion,
  type SuggestionCard,
  type SuggestionList,
} from "./queries/suggestions";
export type { DeckProfile, Reason } from "./domain/suggest";
export { manaBasePlan } from "./queries/mana-base";
export { draftForDeck } from "./queries/draft-deck";
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
  sharedDecks,
  type CardsToGet,
  type CardToGetView,
  type CommentView,
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
  sheetCards,
  tokenDescription,
  tokensToPrint,
  type TokenArt,
  type TokenLine,
  type TokenMaker,
} from "./domain/token-proxies";
export type { ProxyProgress, ProxyStreamEvent } from "./domain/proxy-progress";
