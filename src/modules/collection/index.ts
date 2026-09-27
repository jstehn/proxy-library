// The collection module's public API: the only file other modules and the app may import.
export type { CollectionRepository, CollectionServices } from "./application/ports";
export { giveUpCards } from "./application/give-up-cards";
export { receiveCards } from "./application/receive-cards";
export type { Acquisition, AcquisitionSource, CardGain } from "./domain/cards";
export type { NotEnoughCopies } from "./domain/errors";
export {
  COLLECTION_PAGE_SIZE,
  collectionFor,
  collectionPage,
  ownedCopies,
  type CollectionFilter,
  type CollectionPage,
  type CollectionRow,
  type OwnedCard,
} from "./queries/collection";
