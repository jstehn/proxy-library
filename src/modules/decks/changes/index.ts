// What the other areas and the module root use of decks/changes (ADR 0029).
export * from "./client";
export { makeSwapCards, makeTakeFromDeck } from "./application/deck-builder-moves";
export {
  makeDeckPreviews,
  type ApplyPreviewError,
  type PreviewChangesError,
  type PreviewWarning,
  type SaveChangesError,
  type SavedChanges,
  type StoredPreviewResult,
} from "./application/deck-previews";
export { makeDeckSnapshots, type DeckSnapshots } from "./application/deck-snapshots";
export type { PreviewRepository } from "./application/ports";
export {
  deckChangePreview,
  deckListPreview,
  lineToPreview,
  loadCardsForPreview,
  viewFingerprint,
  type DeckChangePreview,
} from "./queries/preview";
export { deckViewAfterChanges } from "./queries/preview-cast";
export {
  castCurveDeltas,
  MAX_CURVE_CARDS,
  type PreviewCastCurves,
} from "./domain/cast-curve-delta";
export type { DeckChange } from "./domain/preview";
