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
  SetCode,
  type BoosterConfig,
  type DeckList,
  type Finish,
  type Printing,
  type SealedContent,
  type SealedProduct,
} from "./domain/types";
export {
  enabledSets,
  findSet,
  listSetsForAdmin,
  recentSyncRuns,
  setPrintings,
} from "./queries/catalog";
export type { AdminSetRow, PrintingCard, SetSummary, SyncRunRow } from "./queries/catalog";
