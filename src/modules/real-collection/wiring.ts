import { withDb, type DbExecutor } from "@/shared/db";
import {
  isRealCollectionShared,
  printingChoices,
  printingsOfSameCard,
  realCollectionPage,
  realCollectionSets,
  realCopiesOf,
  realProductsOf,
  sharedRealCollections,
} from "./queries/real-collection";

// The real collection's capabilities (ADR 0026): what the Real tab and a card's page read.

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
    },
  };
}
