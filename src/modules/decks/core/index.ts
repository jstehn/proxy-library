// What the other areas and the module root use of decks/core (ADR 0029).
export * from "./client";
export {
  createDeckInTransaction,
  type DeckCardInput,
} from "./application/create-deck-in-transaction";
export type { UpdateDeckError } from "./application/deck-lifecycle";
export type { ReplaceListError, ReplaceReport } from "./application/deck-lists";
export { makeStartDeck, type StartedDeck } from "./application/deck-start";
export {
  type ApplyChangesError,
  type ApplyChangesInput,
  type ApplyChangesReport,
  type SetEntryError,
  type SetEntryInput,
} from "./application/deck-entries";
export { deleteAllDecks } from "./application/delete-all-decks";
export { describeDeckError, type DeckError } from "./application/describe-error";
export { makeListDecks } from "./application/list-decks";
export { makeDecks, type Decks } from "./application/make-decks";
export type { DeckRepository, DecksServices } from "./application/ports";
export { cardFeaturesOf, withFeatures, type FeaturesOf } from "./queries/card-features";
export { comboPartnersForDeck, combosForDeck } from "./queries/combos";
export { getDeckProfile, updateDeckPrimer, updateDeckProfile } from "./queries/deck-profile";
export {
  addDeckSource,
  decksFor,
  decksUsing,
  listDeckSources,
  preconCommanders,
  type DeckRef,
} from "./queries/deck-lists";
export { deckView, loadEdhrecSignals, otherDecksHolding } from "./queries/decks";
export { MOST_SPECIAL_FIRST, STANDARD_FIRST, ownedCopies } from "./queries/owned";
export { cardPrintings, type PrintingFinish, type PrintingOption } from "./queries/printings";
