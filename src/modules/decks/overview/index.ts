// What the other areas and the module root use of decks/overview (ADR 0029).
export { makeDeckFacts, type DeckFacts } from "./application/deck-facts";
export {
  makeDeckOverview,
  type DeckOverview,
  type OverviewParts,
} from "./application/deck-overview";
export { optimizeDeckForView } from "./queries/optimize";
export {
  compareDeckSnapshot,
  listDeckSnapshots,
  type SnapshotComparison,
} from "./queries/snapshots";
export * as deckQueries from "./queries";
export * as deckPublicQueries from "./queries/public";
