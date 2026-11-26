// What the other areas and the module root use of decks/scoring (ADR 0029).
export * from "./client";
export {
  makeDeckCombos,
  type DeckCombos,
  type SpellbookUnavailable,
} from "./application/deck-combos";
export {
  makeEdhrecResearch,
  type CommanderMissing,
  type EdhrecDeckComparison,
  type EdhrecNotFound,
  type EdhrecUnavailable,
} from "./application/deck-edhrec";
export {
  makeDeckSignals,
  makeSearchSignals,
  type DeckSignals,
  type SearchSignals,
} from "./application/deck-signals";
export {
  checkOwnedCards,
  deckSignalCards,
  findCard,
  findCards,
  ownedSignalCards,
} from "./queries/card-facts";
