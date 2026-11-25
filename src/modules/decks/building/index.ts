// What the other areas and the module root use of decks/building (ADR 0029).
export * from "./client";
export { makeDeckPlanEdits } from "./application/deck-plan-edits";
export { makeDeckSearch } from "./application/deck-search";
export { makeDeckManaPlan } from "./application/deck-mana-plan";
export { makeFindReplacements, type SimilarCards } from "./application/find-replacements";
export {
  budgetList,
  budgetReplacements,
  deckSuggestions,
  similarCards,
  type BudgetList,
  type DeckSuggestions,
} from "./application/suggest-cards";
export { auditDeck, auditDeckView } from "./queries/audit";
export {
  BROWSE_SORTS,
  BROWSE_SOURCES,
  browseCollection,
  type BrowseInput,
  type BrowsePage,
  type BrowseSort,
  type BrowseSource,
} from "./queries/browse";
export { draftForDeck } from "./queries/build-from-collection";
export { commanderDetails, commandersICanBuild, type CommanderSearch } from "./queries/commanders";
export { embedSimForCards } from "./queries/embeddings";
export { manaBasePlan } from "./queries/mana-base";
export { searchForDeck, type SearchForDeck } from "./queries/search-for-deck";
export {
  semanticSearchCatalog,
  semanticSearchForDeck,
  type SemanticSearchResult,
} from "./queries/semantic-search";
export { candidatePool } from "./queries/suggestion-pool";
