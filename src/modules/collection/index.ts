// The collection module's public API: the only file other modules and the app may import.
export type { CollectionServices } from "./application/ports";
export { giveUpCards } from "./application/give-up-cards";
export { giveUpEverything } from "./application/give-up-everything";
export { receiveCards } from "./application/receive-cards";
export type { CardGain } from "./domain/cards";
export type { NotEnoughCopies } from "./domain/errors";
export { COLLECTION_EXPORTERS, type ExportRow } from "./domain/export";
export type { CollectionFilter, CollectionPage, CollectionRow } from "./queries/collection";
export * as collectionQueries from "./queries";
