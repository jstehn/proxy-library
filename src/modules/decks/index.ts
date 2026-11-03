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
  CreateDeckError,
  ImportReport,
  ReplaceListError,
  ReplaceListInput,
  ReplaceReport,
  SetEntryError,
  SetEntryInput,
  UpdateDeckError,
} from "./application/manage-decks";
export type {
  CardLookup,
  DeckRepository,
  DeckSharingRepository,
  DeckSharingServices,
  DecksDependencies,
  DecksServices,
} from "./application/ports";
export {
  becomesADeck,
  BOARDS,
  DeckId,
  DeckOrigin,
  FORMATS,
  MAX_LIST_LINES,
  MAX_QUANTITY,
  type Board,
  type Deck,
  type Format,
} from "./domain/deck";
export type {
  CardNotFound,
  CommentInvalid,
  CommentNotFound,
  DeckChanged,
  DeckNotFound,
  ListProblems,
  ListTooLong,
  NotAllowed,
  NameInvalid,
  QuantityInvalid,
  TooManyDecks,
} from "./domain/errors";
export {
  deckText,
  EXPORTERS,
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
  decksUsing,
  deckView,
  decksFor,
  type DeckRef,
  preconCommanders,
  type PreconCommanders,
  type DeckLine,
  type DeckSummary,
  type DeckView,
} from "./queries/decks";
export {
  BROWSE_PAGE_SIZE,
  BROWSE_SORTS,
  browseCollection,
  deckBrowseContext,
  type BrowseCard,
  type BrowseInput,
  type BrowsePage,
  type BrowseSort,
} from "./queries/browse";
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
export { makeProxySheets, type ProxySheet } from "./application/proxy-sheets";
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
  type ProxyLine,
  type ProxyOptions,
} from "./domain/proxy-sheet";
export type { ProxyProgress, ProxyStreamEvent } from "./domain/proxy-progress";
