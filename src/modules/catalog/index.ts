// The catalog module's public API: the only file other modules and the app may import.
export type { RequestSyncError, SetSetEnabledError } from "./application/admin";

export { makeCatalog } from "./application/make-catalog";
export type { Catalog } from "./application/make-catalog";

export { EMBEDDING_DIMS, EMBEDDING_MODEL, EMBEDDING_TEXT_VERSION } from "./domain/embedding-text";

export {
  COLORS,
  FINISHES,
  PrintingId,
  RARITIES,
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
} from "./domain/types";
export { extractFeatures } from "./domain/features/registry";
export type { SignalFact, TapMana } from "./domain/features/types";
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
export { lookupRules } from "./queries/rules";

export type {
  EdhrecCardItem,
  EdhrecCommanderData,
  SpellbookCombo,
  SpellbookCombosResult,
} from "./domain/outside-data";
export {
  makeRulesLookup,
  type CardInteractions,
  type CardRulings,
  type RulesCardNotFound,
} from "./application/rules-lookup";
export { describePhotoError } from "./application/describe-error";
