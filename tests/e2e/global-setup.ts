// Runs once before the browser tests: bring the e2e database up to date, empty it, and load the
// card catalog from the recorded fixtures (the real sync code, with file-based gateways, so no
// network is used).
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { makeCatalog } from "@/modules/catalog";
import {
  diskArtworkStore,
  diskImageStore,
  drizzleArtworkRepository,
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
  fixtureMtgjsonGateway,
  fixtureScryfallGateway,
  fixtureWpnGateway,
} from "@/modules/catalog/infrastructure";
import { E2E_IMAGE_CACHE_DIR } from "../../playwright.config";
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
    // The tests' amounts ($50.00 to start, $20.00 a week) are pinned here, so they don't depend
    // on the defaults (which are $200.00 and $50.00).
    await db.execute(
      sql`update economy_settings set starting_grant_cents = 5000, allowance_cents = 2000 where id = 1`,
    );
    await db.execute(
      sql`truncate sync_runs, price_snapshots, deck_lists, sealed_products, booster_configs, printings, card_sets, artwork_files cascade`,
    );

    const catalog = makeCatalog({
      unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
        catalog: drizzleCatalogRepository(transaction),
        syncRuns: drizzleSyncRunRepository(transaction),
        artwork: drizzleArtworkRepository(transaction),
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
      // Recorded WPN pages; "downloads" are placeholder images in the e2e image folder.
      wpn: fixtureWpnGateway(),
      artworkFiles: diskArtworkStore(E2E_IMAGE_CACHE_DIR),
      clock: systemClock(),
      syncTime: { hour: 4, minute: 0 },
    });
    await catalog.queueSync("prices");
    const result = await catalog.runNextQueuedSync();
    if (result?.status !== "succeeded") throw new Error("fixture catalog sync failed");

    // Card images the server itself reads (proxy PDFs) are placeholders already in the cache,
    // so it never downloads one. (The browser's own image requests are stubbed in each test.)
    const placeholder = new Uint8Array(readFileSync("tests/fixtures/images/card.jpg"));
    const cardImages = diskImageStore(E2E_IMAGE_CACHE_DIR);
    const printings = await db.execute<{ scryfall_id: string; has_back: boolean }>(sql`
      select scryfall_id, coalesce(jsonb_typeof(image_uris->'back') = 'object', false) as has_back
        from printings where image_uris is not null
    `);
    for (const printing of printings.rows) {
      const faces = printing.has_back ? (["front", "back"] as const) : (["front"] as const);
      for (const face of faces) {
        await cardImages.put(
          { size: "large", scryfallId: printing.scryfall_id, face },
          placeholder,
        );
      }
    }
  } finally {
    await close();
  }
}
