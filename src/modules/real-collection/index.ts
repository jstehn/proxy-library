// The real collection's public API (design doc 16): the only file the app, the composition
// roots and the decks module may import. No game module may (rule 1, lint-enforced).
export { makeRealCollection, type RealCollection } from "./application/make-real-collection";
export {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_LINES,
  matchedCopies,
  type ApplyImportError,
  type ApplyImportInput,
  type ImportPreview,
  type PreviewImportError,
} from "./application/import";
export type { ChangeRealPrintingError, SetRealCopiesError } from "./application/manage-copies";
export type {
  CollectionVersion,
  PrintingMatcher,
  ProductContents,
  RealCollectionRepository,
  RealCollectionServices,
} from "./application/ports";
export type {
  AddedRealProduct,
  AddRealProductError,
  AddRealProductInput,
} from "./application/real-products";
export { MAX_REAL_QUANTITY, type RealCopy, type RealCopyKey } from "./domain/copies";
export type { ImportMode, ImportPlan } from "./domain/import-plan";
export type { MatchedLine, UnmatchedReason } from "./domain/match";
export type { ProductCards, ProductDeck } from "./domain/product-cards";
export type { ImportFormat, ImportLine } from "./domain/readers";
export {
  isRealCollectionShared,
  printingChoices,
  printingsOfSameCard,
  REAL_COLLECTION_PAGE_SIZE,
  realCollectionPage,
  realCopiesOf,
  realExportRows,
  realPrintingIds,
  realCollectionSets,
  realProductCounts,
  realProductsOf,
  sharedRealCollections,
  type PrintingChoice,
  type RealCollectionFilter,
  type RealCollectionPage,
  type RealCollectionRow,
  type RealExportRow,
  type RealProductRow,
  type SharedRealCollection,
} from "./queries/real-collection";
