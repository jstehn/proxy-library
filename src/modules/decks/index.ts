// The decks module's public API: the only file other modules and the app may import.
export { deleteAllDecks } from "./application/delete-all-decks";
export { makeDecks, type Decks } from "./application/make-decks";
export type {
  CreateDeckError,
  DeckCardInput,
  ImportReport,
  SetEntryError,
  SetEntryInput,
  UpdateDeckError,
} from "./application/manage-decks";
export type {
  CardLookup,
  DeckRepository,
  DecksDependencies,
  DecksServices,
} from "./application/ports";
export {
  becomesADeck,
  BOARDS,
  DeckId,
  FORMATS,
  MAX_QUANTITY,
  type Board,
  type Deck,
  type Format,
} from "./domain/deck";
export type {
  CardNotFound,
  DeckNotFound,
  NameInvalid,
  QuantityInvalid,
  TooManyDecks,
} from "./domain/errors";
export { EXPORTERS, type ExportLine } from "./domain/list-format";
export {
  canBeCommander,
  deckProblems,
  invalidCommanders,
  shortCount,
  type CardRules,
  type DeckProblem,
} from "./domain/rules";
export { deckStats, mainType, TYPE_ORDER, type DeckStats } from "./domain/stats";
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
export { parseSearch, type ParsedSearch, type SearchNode } from "./domain/search";
