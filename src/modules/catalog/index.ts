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
  TextEmbedder,
  EmbeddingRepository,
  ComprehensiveRulesGateway,
  ComprehensiveRulesRepository,
  ComprehensiveRuleRow,
  WpnGateway,
} from "./application/ports";
export { EMBEDDING_DIMS, EMBEDDING_MODEL, EMBEDDING_TEXT_VERSION } from "./domain/embedding-text";
export type { SyncSummary } from "./application/sync";
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
  searchPrintings,
  setPrintings,
} from "./queries/catalog";
export { makeSearchCatalog } from "./application/search-catalog";
export type { CatalogSearch } from "./application/search-catalog";
export { makeCardLookup } from "./application/card-lookup";
export type { CardLookup } from "./application/card-lookup";
export { storePrintingsOfCard, type StorePrinting } from "./queries/store-printings";
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
export { lookupRules, type LookupRulesResult, type RuleSearchHit } from "./queries/rules";
export type { ParsedRule, RuleKind } from "./domain/comprehensive-rules";
export {
  findRuleInteractions,
  findSharedRules,
  matchRelatedRules,
  type RelatedRuleMatch,
  type RuleInteractionMatch,
} from "./domain/related-rules";
export type {
  ScryfallRuling,
  ScryfallRulingsResult,
  EdhrecCardItem,
  EdhrecThemeTag,
  EdhrecCommanderData,
  SpellbookCombo,
  SpellbookOneCardAwayCombo,
  SpellbookCombosResult,
} from "./domain/outside-data";
export {
  makeRulesLookup,
  type CardInteractions,
  type CardRulings,
  type RulesCard,
  type RulesCardNotFound,
} from "./application/rules-lookup";
export { describePhotoError } from "./application/describe-error";
