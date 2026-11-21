// What the other areas and the module root use of decks/core (ADR 0029).
export * from "./client";
export {
  createDeckInTransaction,
  type DeckCardInput,
} from "./application/create-deck-in-transaction";
export { makeSwapCards, makeTakeFromDeck } from "./application/deck-builder-moves";
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
export type { UpdateDeckError } from "./application/deck-lifecycle";
export type { ReplaceListError, ReplaceReport } from "./application/deck-lists";
export { makeDeckPlanEdits } from "./application/deck-plan-edits";
export {
  makeDeckPreviews,
  type ApplyPreviewError,
  type PreviewChangesError,
  type PreviewWarning,
  type SaveChangesError,
  type SavedChanges,
  type StoredPreviewResult,
} from "./application/deck-previews";
export { makeDeckSearch } from "./application/deck-search";
export { makeStartDeck, type StartedDeck } from "./application/deck-start";
export { deleteAllDecks } from "./application/delete-all-decks";
export { describeDeckError, type DeckError } from "./application/describe-error";
export { makeListDecks } from "./application/list-decks";
export { makeDecks, type Decks } from "./application/make-decks";
export type { DeckRepository, DecksServices, PreviewRepository } from "./application/ports";
export { cardFeaturesOf, withFeatures, type FeaturesOf } from "./queries/card-features";
export { comboPartnersForDeck, combosForDeck } from "./queries/combos";
export { getDeckProfile, updateDeckPrimer, updateDeckProfile } from "./queries/deck-profile";
export {
  addDeckSource,
  deckView,
  decksFor,
  decksUsing,
  listDeckSources,
  loadEdhrecSignals,
  otherDecksHolding,
  preconCommanders,
  type DeckRef,
} from "./queries/decks";
export { MOST_SPECIAL_FIRST, STANDARD_FIRST, ownedCopies } from "./queries/owned";
export {
  deckChangePreview,
  deckListPreview,
  lineToPreview,
  loadCardsForPreview,
  viewFingerprint,
  type DeckChangePreview,
} from "./queries/preview";
export { cardPrintings, type PrintingFinish, type PrintingOption } from "./queries/printings";
