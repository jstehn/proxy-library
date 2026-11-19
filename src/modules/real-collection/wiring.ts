import { withDb, type DbExecutor } from "@/shared/db";
import {
  isRealCollectionShared,
  printingChoices,
  printingsOfSameCard,
  realCollectionPage,
  realCollectionSets,
  realCopiesOf,
  realProductCounts,
  realExportRows,
  realProductsOf,
  sharedRealCollections,
} from "./queries/real-collection";

// The real-collection module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireRealCollectionCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    realCollectionReads: {
      page: withDb(db, realCollectionPage),
      sets: withDb(db, realCollectionSets),
      productsOf: withDb(db, realProductsOf),
      isShared: withDb(db, isRealCollectionShared),
      shared: withDb(db, sharedRealCollections),
      printingChoices: withDb(db, printingChoices),
      printingsOfSameCard: withDb(db, printingsOfSameCard),
      copiesOf: withDb(db, realCopiesOf),
      exportRows: withDb(db, realExportRows),
      productCounts: withDb(db, realProductCounts),
    },
  };
}
