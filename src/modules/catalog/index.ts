// The catalog module's public API: the only file other modules and the app may import.
export type {
  ChoosePhotoError,
  RequestSyncError,
  SetPageSlugError,
  SetSetEnabledError,
} from "./application/admin";
export type { ArtworkSummary } from "./application/artwork";
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
  ArtworkRepository,
  ArtworkStore,
  SyncKind,
  SyncRunRepository,
  WpnGateway,
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
  priceHistory,
  printingCards,
  printingDetail,
  recentSyncRuns,
  SEARCH_PAGE_SIZE,
  searchPrintings,
  setPrintings,
} from "./queries/catalog";
export type {
  AdminSetRow,
  PricePoint,
  PrintingCard,
  PrintingDetail,
  PrintingSearch,
  SearchResult,
  SetSummary,
  SyncRunRow,
} from "./queries/catalog";
export { variantFor, type ArtworkSize, type ContentsLine } from "./domain/wpn";
export {
  packKey,
  packPhotos,
  photosOverview,
  productPhotos,
  setPhotos,
  type SetPhotosView,
} from "./queries/artwork";
