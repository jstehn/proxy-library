// The catalog use cases against real Postgres, with recorded fixtures instead of the network.
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { loadConfig } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork } from "@/shared/db";
import { err, UserId } from "@/shared/kernel";
import { manualClock } from "@/shared/kernel/testing";
import { makeCatalog } from "../application/make-catalog";
import type { MtgjsonGateway } from "../application/ports";
import { PrintingId, SetCode } from "../domain/types";
import { fakeImageFetcher, inMemoryImageStore } from "../testing/fakes";
import { drizzleCatalogRepository, drizzleSyncRunRepository } from "./drizzle-repositories";
import { fixtureMtgjsonGateway, fixtureScryfallGateway } from "./fixture-gateways";

const { db, close } = createDatabase(loadConfig().databaseUrl);
afterAll(close);

const admin: Actor = {
  userId: UserId.of("admin"),
  username: "admin" as Actor["username"],
  displayName: "Admin" as Actor["displayName"],
  isAdmin: true,
  canSelfFund: false,
  mustChangePassword: false,
};

let clock: ReturnType<typeof manualClock>;
let mtgjson: ReturnType<typeof fixtureMtgjsonGateway>;
let images: ReturnType<typeof inMemoryImageStore>;
let imageFetcher: ReturnType<typeof fakeImageFetcher>;

function buildCatalog(gateway: MtgjsonGateway = mtgjson) {
  return makeCatalog({
    unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
      catalog: drizzleCatalogRepository(transaction),
      syncRuns: drizzleSyncRunRepository(transaction),
    })),
    mtgjson: gateway,
    scryfall: fixtureScryfallGateway(),
    images,
    imageFetcher,
    clock,
    syncTime: { hour: 4, minute: 0 },
  });
}

async function countRows(table: string): Promise<number> {
  const result = await db.execute<{ total: number }>(
    sql.raw(`select count(*)::int as total from ${table}`),
  );
  return result.rows[0].total;
}

beforeEach(async () => {
  await db.execute(
    sql`truncate sync_runs, price_snapshots, deck_lists, sealed_products, booster_configs, printings, card_sets cascade`,
  );
  clock = manualClock("2026-09-27T12:00:00Z");
  mtgjson = fixtureMtgjsonGateway();
  images = inMemoryImageStore();
  imageFetcher = fakeImageFetcher();
});

describe("the first sync", () => {
  it("enables Standard sets, imports supporting sets first, and prices everything", async () => {
    const summary = await buildCatalog().runSync("prices");

    // Only paper sets are listed: YBLB (online-only Alchemy) is left out.
    expect(summary.setsInList).toBe(4);
    expect(summary.enabledAsStandard).toEqual(["BLB"]);
    expect(summary.importedSupportingSets).toEqual(["SPG"]);
    expect(summary.importedSets).toEqual(["BLB"]);
    expect(summary.failedSets).toEqual([]);
    expect(summary.skippedDigital).toEqual({
      printings: 1,
      boosterTypes: ["BLB: play-arena"],
      products: ["BLB: Bloomburrow MTGO Redemption"],
      decks: ["BLB: Bloomburrow Redemption"],
    });

    expect(await countRows("printings")).toBe(27 + 2);
    expect(await countRows("booster_configs")).toBe(1);
    expect(await countRows("sealed_products")).toBe(5);
    expect(await countRows("deck_lists")).toBe(2);
    expect(summary.pricedPrintings).toBe(29);
    expect(await countRows("price_snapshots")).toBe(summary.priceSnapshots);

    const sets = await db.execute<{ code: string; is_enabled: boolean; is_supporting: boolean }>(
      sql`select code, is_enabled, is_supporting from card_sets order by code`,
    );
    expect(sets.rows).toEqual([
      { code: "BLB", is_enabled: true, is_supporting: false },
      { code: "BLC", is_enabled: false, is_supporting: false },
      { code: "FDN", is_enabled: false, is_supporting: false },
      { code: "SPG", is_enabled: false, is_supporting: true },
    ]);
  });

  it("stores images and legalities from Scryfall on each printing", async () => {
    await buildCatalog().runSync("prices");
    const rows = await db.execute<{ with_images: number }>(
      sql`select count(*)::int as with_images from printings where image_uris is not null`,
    );
    expect(rows.rows[0].with_images).toBe(29);
  });
});

describe("running again", () => {
  it("is idempotent on the same day: no duplicate printings or snapshots", async () => {
    const catalog = buildCatalog();
    const first = await catalog.runSync("prices");
    const second = await catalog.runSync("prices");
    expect(second.importedSets).toEqual([]); // already imported, same version
    expect(await countRows("printings")).toBe(29);
    expect(await countRows("price_snapshots")).toBe(first.priceSnapshots);
  });

  it("adds a new day's snapshots and keeps the old ones (ADR 0013)", async () => {
    const catalog = buildCatalog();
    const first = await catalog.runSync("prices");
    clock.advanceBy(24 * 60 * 60 * 1000);
    await catalog.runSync("prices");
    expect(await countRows("price_snapshots")).toBe(2 * first.priceSnapshots);
  });

  it("a full run doesn't re-download sets whose MTGJSON version is unchanged", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    mtgjson.downloads.length = 0;
    await catalog.runSync("full");
    expect(mtgjson.downloads).toEqual([]);
  });
});

describe("rule 5: nothing may refer to a missing card", () => {
  it("refuses to import a set whose supporting set isn't available", async () => {
    const withoutSpg = fixtureMtgjsonGateway({ hideSets: ["SPG"] });
    const summary = await buildCatalog(withoutSpg).runSync("prices");
    expect(summary.importedSets).toEqual([]);
    expect(summary.failedSets).toEqual([
      { code: "BLB", problems: ["booster play, sheet specialGuest: 2 unknown card(s)"] },
    ]);
    expect(await countRows("printings")).toBe(0); // nothing half-saved
  });
});

describe("the sync queue", () => {
  it("queues one run at a time and runs it, recording the summary", async () => {
    const catalog = buildCatalog();
    expect((await catalog.requestSync(admin, "full")).ok).toBe(true);
    expect(await catalog.requestSync(admin, "full")).toEqual(err({ kind: "SyncAlreadyQueued" }));

    const result = await catalog.runNextQueuedSync();
    expect(result?.status).toBe("succeeded");
    expect(await catalog.runNextQueuedSync()).toBeNull(); // queue empty

    const runs = await db.execute<{ status: string; imported: string }>(
      sql`select status, summary->>'importedSets' as imported from sync_runs`,
    );
    expect(runs.rows).toEqual([{ status: "succeeded", imported: '["BLB"]' }]);
  });

  it("marks a run left 'running' by a crash as failed", async () => {
    const catalog = buildCatalog();
    await catalog.requestSync(admin, "prices");
    await db.execute(sql`update sync_runs set status = 'running', started_at = now()`);
    expect(await catalog.recoverInterruptedRuns()).toBe(1);
  });

  it("queues the nightly run once it's due, and only once", async () => {
    clock.set(new Date(2026, 8, 27, 4, 30)); // 04:30 local time
    const catalog = buildCatalog();
    expect(await catalog.queueNightlyIfDue()).toBe(true);
    expect(await catalog.queueNightlyIfDue()).toBe(false); // already queued
    await catalog.runNextQueuedSync();
    expect(await catalog.queueNightlyIfDue()).toBe(false); // today's has run
  });

  it("is admin-only", async () => {
    const player = { ...admin, isAdmin: false };
    expect(await buildCatalog().requestSync(player, "full")).toEqual(err({ kind: "Forbidden" }));
  });
});

describe("enabling sets", () => {
  it("enabling a set queues a sync to import it", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    await db.execute(sql`truncate sync_runs`);
    expect(
      (await catalog.setSetEnabled(admin, { code: SetCode.of("FDN"), enabled: true })).ok,
    ).toBe(true);
    expect(await countRows("sync_runs")).toBe(1);
    expect(await catalog.setSetEnabled(admin, { code: SetCode.of("ZZZ"), enabled: true })).toEqual(
      err({ kind: "SetNotFound" }),
    );
  });

  it("'Enable Standard sets' adds only Standard sets that aren't enabled yet", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    await catalog.setSetEnabled(admin, { code: SetCode.of("BLB"), enabled: false });
    const enabled = await catalog.enableStandardSets(admin);
    expect(enabled.ok && enabled.value).toEqual(["BLB"]);
  });
});

describe("images", () => {
  it("fetches an image once, then serves it from the cache", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    const [row] = (await db.execute<{ id: string }>(sql`select id from printings limit 1`)).rows;
    const request = {
      printingId: PrintingId.of(row.id),
      size: "normal" as const,
      face: "front" as const,
    };

    const first = await catalog.imageFor(request);
    const second = await catalog.imageFor(request);
    expect(first.ok && second.ok).toBe(true);
    expect(imageFetcher.fetched).toHaveLength(1);
    expect(imageFetcher.fetched[0]).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\//);
  });

  it("reports an unknown printing or a missing back face", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    const [row] = (await db.execute<{ id: string }>(sql`select id from printings limit 1`)).rows;
    expect(
      await catalog.imageFor({ printingId: PrintingId.of("nope"), size: "small", face: "front" }),
    ).toEqual(err({ kind: "ImageNotFound" }));
    expect(
      await catalog.imageFor({ printingId: PrintingId.of(row.id), size: "small", face: "back" }),
    ).toEqual(err({ kind: "ImageNotFound" }));
  });
});
