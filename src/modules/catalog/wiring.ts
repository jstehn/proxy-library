import { withDb, type DbExecutor } from "@/shared/db";
import { packPhotos, photosOverview, productPhotos, setPhotos } from "./queries/artwork";
import {
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
      photosOverview: withDb(db, photosOverview),
      setPhotos: withDb(db, setPhotos),
      listSetsForAdmin: withDb(db, listSetsForAdmin),
      recentSyncRuns: withDb(db, recentSyncRuns),
      searchPrintings: withDb(db, searchPrintings),
      setPrintings: withDb(db, setPrintings),
      priceHistory: withDb(db, priceHistory),
      printingDetail: withDb(db, printingDetail),
    },
  };
}
