// The decks module's public API: the only file other modules and the app may import. It lists
// exactly what they use (each area's index.ts, ADR 0029, offers more to its sibling areas).
export * from "./client";
export {
  createDeckInTransaction,
  type DeckCardInput,
  type DeckError,
  type DeckRef,
  type Decks,
  decksFor,
  type DecksServices,
  decksUsing,
  deckView,
  deleteAllDecks,
  describeDeckError,
  makeDecks,
  preconCommanders,
  type PrintingFinish,
  type PrintingOption,
  type ReplaceListError,
  type ReplaceReport,
  type StartedDeck,
  type UpdateDeckError,
} from "./core";
export { type CommentView, type DeckSharing, makeDeckSharing } from "./sharing";
export {
  type ApplyPreviewError,
  type DeckChangePreview,
  type DeckSnapshots,
  makeDeckSnapshots,
  type PreviewChangesError,
  type PreviewRepository,
  type PreviewWarning,
  type SaveChangesError,
  type SavedChanges,
  type StoredPreviewResult,
} from "./changes";
export {
  type CommanderMissing,
  type DeckCombos,
  type DeckSignals,
  type EdhrecDeckComparison,
  type EdhrecNotFound,
  type EdhrecUnavailable,
  findCard,
  type SearchSignals,
  type SpellbookUnavailable,
} from "./scoring";
export {
  auditDeck,
  BROWSE_SORTS,
  BROWSE_SOURCES,
  browseCollection,
  type BrowsePage,
  type BrowseSort,
  type BrowseSource,
  type BudgetList,
  budgetReplacements,
  candidatePool,
  type DeckSuggestions,
  embedSimForCards,
  type SearchForDeck,
  semanticSearchForDeck,
  type SemanticSearchResult,
  similarCards,
  type SimilarCards,
} from "./building";
export { type CastReport } from "./play";
export { makeProxySheets, makeTokenChoices, type ProxyDeck, type ProxySheetInput } from "./proxies";
export {
  compareDeckSnapshot,
  type DeckFacts,
  type DeckOverview,
  deckPublicQueries,
  deckQueries,
  optimizeDeckForView,
  type OverviewParts,
  type SnapshotComparison,
} from "./overview";
