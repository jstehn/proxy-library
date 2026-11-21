// What the other areas and the module root use of decks/sharing (ADR 0029).
export * from "./client";
export { makeDeckSharing, type DeckSharing } from "./application/sharing";
export {
  cardsToGetFor,
  deckComments,
  deckForViewer,
  deckViewForViewer,
  publicDeck,
  sharedDecks,
  type CommentView,
} from "./queries/sharing";
