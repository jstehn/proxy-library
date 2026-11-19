import { withDb, type DbExecutor } from "@/shared/db";
import { openingView, recentOpenings, unopenedItems } from "./queries/inventory";

// The inventory's capabilities (ADR 0026): what the inventory pages read.

export function wireInventoryCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    inventoryReads: {
      recentOpenings: withDb(db, recentOpenings),
      unopenedItems: withDb(db, unopenedItems),
      openingView: withDb(db, openingView),
    },
  };
}
