// What the other areas and the module root use of decks/scoring (ADR 0029).
export * from "./client";
export {
  makeDeckSignals,
  makeSearchSignals,
  type DeckSignals,
  type SearchSignals,
} from "./application/deck-signals";
export { checkOwnedCards, deckSignalCards, findCard, ownedSignalCards } from "./queries/card-facts";
