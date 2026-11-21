// What the other areas and the module root use of decks/building (ADR 0029).
export * from "./client";
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
export { cheapestForSale, cheapestOfCards, notOwned, ownedPerCard } from "./queries/candidate-pool";
export { commanderDetails, commandersICanBuild, type CommanderSearch } from "./queries/commanders";
export { embedSimForCards } from "./queries/embeddings";
export { manaBasePlan } from "./queries/mana-base";
export { searchForDeck, type SearchForDeck } from "./queries/search-for-deck";
export { semanticSearchForDeck, type SemanticSearchResult } from "./queries/semantic-search";
export { candidatePool } from "./queries/suggestion-pool";
