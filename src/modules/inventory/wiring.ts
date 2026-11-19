import { withDb, type DbExecutor } from "@/shared/db";
import { openingView, recentOpenings, unopenedItems } from "./queries/inventory";

// The inventory module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

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
