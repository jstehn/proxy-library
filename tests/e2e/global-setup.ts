// Runs once before the browser tests: bring the e2e database up to date, empty it, and load the
// card catalog from the recorded fixtures (the real sync code, with file-based gateways, so no
// network is used).
import { sql } from "drizzle-orm";
import { makeCatalog } from "@/modules/catalog";
import {
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
  fixtureMtgjsonGateway,
  fixtureScryfallGateway,
} from "@/modules/catalog/infrastructure";
import { loadConfig } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork, runMigrations } from "@/shared/db";
import { systemClock } from "@/shared/runtime";

export default async function globalSetup() {
  const { databaseUrl } = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.E2E_DATABASE_URL,
  });
  if (!databaseUrl.includes("_e2e")) {
    throw new Error(`Refusing to reset a non-e2e database: ${databaseUrl}`);
  }
  const { db, close } = createDatabase(databaseUrl);
  try {
    await runMigrations(db);
    await db.execute(sql`truncate invites, players, auth_users cascade`);
    await db.execute(
      sql`truncate sync_runs, price_snapshots, deck_lists, sealed_products, booster_configs, printings, card_sets cascade`,
    );

    const catalog = makeCatalog({
      unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
        catalog: drizzleCatalogRepository(transaction),
        syncRuns: drizzleSyncRunRepository(transaction),
      })),
      mtgjson: fixtureMtgjsonGateway(),
      scryfall: fixtureScryfallGateway(),
      images: {
        get: async () => null,
        put: async () => {},
      },
      imageFetcher: {
        fetch: async () => {
          throw new Error("no image downloads during setup");
        },
      },
      clock: systemClock(),
      syncTime: { hour: 4, minute: 0 },
    });
    await catalog.queueSync("prices");
    const result = await catalog.runNextQueuedSync();
    if (result?.status !== "succeeded") throw new Error("fixture catalog sync failed");
  } finally {
    await close();
  }
}
