// The catalog module's public API: the only file other modules and the app may import.
export type { RequestSyncError, SetSetEnabledError } from "./application/admin";
export { makeCatalog } from "./application/make-catalog";
export type { Catalog } from "./application/make-catalog";
export type {
  CatalogDependencies,
  CatalogRepository,
  CatalogServices,
  ImageFace,
  ImageFetcher,
  ImageSize,
  ImageStore,
  MtgjsonGateway,
  ScryfallGateway,
  SyncKind,
  SyncRunRepository,
} from "./application/ports";
export type { SyncSummary } from "./application/sync";
export {
  FINISHES,
  PrintingId,
  SealedProductId,
  SetCode,
  type BoosterConfig,
  type BoosterSheet,
  type CardFace,
  type Color,
  type DeckList,
  type Finish,
  type Printing,
  type Rarity,
  type SealedContent,
  type SealedProduct,
  type DeckCard,
} from "./domain/types";
export {
  enabledSets,
  findSet,
  listSetsForAdmin,
  printingCards,
  recentSyncRuns,
  setPrintings,
} from "./queries/catalog";
export type { AdminSetRow, PrintingCard, SetSummary, SyncRunRow } from "./queries/catalog";
