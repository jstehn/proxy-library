import { withDb, type DbExecutor } from "@/shared/db";
import { packPhotos, productPhotos } from "./queries/artwork";
import {
  enabledSets,
  findSet,
  priceHistory,
  printingCards,
  printingDetail,
} from "./queries/catalog";

// The catalog's capabilities (ADR 0026). The ones that read across modules (card lookup, search,
// rules lookup) are joined in src/server/capabilities.ts.

export function wireCatalogCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    /** Card details for printings, for the selected-card panel and previews. */
    printingDetails: (printingIds: readonly string[]) => printingCards(db, printingIds),
    catalogReads: {
      enabledSets: withDb(db, enabledSets),
      findSet: withDb(db, findSet),
      packPhotos: withDb(db, packPhotos),
      productPhotos: withDb(db, productPhotos),
      priceHistory: withDb(db, priceHistory),
      printingDetail: withDb(db, printingDetail),
    },
  };
}
