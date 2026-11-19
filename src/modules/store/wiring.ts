import { withDb, type DbExecutor } from "@/shared/db";
import { currentBuylistRate, packMsrps, singleHistory, storePage } from "./queries/store";

// The store's capabilities (ADR 0026): what the store pages read.

export function wireStoreCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    storeReads: {
      page: withDb(db, storePage),
      packMsrps: withDb(db, packMsrps),
      singleHistory: withDb(db, singleHistory),
      buylistRate: withDb(db, currentBuylistRate),
    },
  };
}
