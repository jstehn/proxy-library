import { withDb, type DbExecutor } from "@/shared/db";
import { quoteShoppingList } from "./queries/shopping-list";
import {
  currentBuylistRate,
  currentPricingMode,
  kindPrices,
  msrpsBelowResale,
  packMsrps,
  packPrice,
  productPrices,
  singleHistory,
  storePage,
  storeSearch,
} from "./queries/store";

// The store module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireStoreCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    storeReads: {
      page: withDb(db, storePage),
      packMsrps: withDb(db, packMsrps),
      singleHistory: withDb(db, singleHistory),
      buylistRate: withDb(db, currentBuylistRate),
      pricingMode: withDb(db, currentPricingMode),
      kindPrices: withDb(db, kindPrices),
      msrpsBelowResale: withDb(db, msrpsBelowResale),
      packPrice: withDb(db, packPrice),
      productPrices: withDb(db, productPrices),
      quoteShoppingList: withDb(db, quoteShoppingList),
      search: withDb(db, storeSearch),
    },
  };
}
