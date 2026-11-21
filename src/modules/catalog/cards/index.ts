// What the other areas and the module root use of catalog/cards (ADR 0030): card data, prices,
// images, artwork, the sync and the reads on them.
export type { SetSetEnabledError } from "./application/admin";
export { makeCatalogAdmin } from "./application/admin";
export { makeSync } from "./application/sync";
export type { CardsDependencies, CardsServices, MtgjsonGateway } from "./application/ports";

export {
  FINISHES,
  PrintingId,
  SealedProductId,
  SetCode,
  type BoosterConfig,
  type BoosterSheet,
  type CardFace,
  type Color,
  type SealedContent,
  type SealedProduct,
} from "./domain/types";
export type { CardFeatures, EntersTapped, SignalFact, TapMana } from "./domain/features/types";
export { extractFeatures } from "./domain/features/registry";
export { printingCards } from "./queries/printing-cards";
export * as catalogQueries from "./queries";
export { makeSearchCatalog } from "./application/search-catalog";
export type { CatalogSearch } from "./application/search-catalog";
export { makeCardLookup } from "./application/card-lookup";
export type { CardLookup } from "./application/card-lookup";
export { storePrintingsOfCard } from "./queries/store-printings";
export type { AdminSetRow, SyncRunRow } from "./queries/catalog";
export type { PrintingCard } from "./queries/printing-cards";
export { variantFor } from "./domain/wpn";
export { packKey } from "./queries/pack-key";
export { describePhotoError } from "./application/describe-error";
