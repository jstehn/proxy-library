// The real collection's public API (design doc 16): the only file the app, the composition
// roots and the decks module may import. No game module may (rule 1, lint-enforced).
export { makeRealCollection } from "./application/make-real-collection";
export {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_LINES,
  matchedCopies,
  type ImportPreview,
} from "./application/import";

export { MAX_REAL_QUANTITY } from "./domain/copies";

export type { MatchedLine, UnmatchedReason } from "./domain/match";
export type { ProductDeck } from "./domain/product-cards";

export type {
  PrintingChoice,
  RealCollectionPage,
  RealCollectionRow,
} from "./queries/real-collection";
export { realPrintingIds } from "./queries/printing-ids";
export * as realCollectionQueries from "./queries";
