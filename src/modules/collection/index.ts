// The collection module's public API: the only file other modules and the app may import.
export type { CollectionRepository, CollectionServices } from "./application/ports";
export { receiveCards } from "./application/receive-cards";
export type { Acquisition, AcquisitionSource, CardGain } from "./domain/cards";
export { collectionFor, type OwnedCard } from "./queries/collection";
