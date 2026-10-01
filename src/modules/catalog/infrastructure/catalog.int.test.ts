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
import { drizzleArtworkRepository } from "./drizzle-artwork";
import { fixtureMtgjsonGateway, fixtureScryfallGateway } from "./fixture-gateways";
import { fixtureWpnGateway, memoryArtworkStore } from "./wpn";

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
let wpn: ReturnType<typeof fixtureWpnGateway>;
let artworkFiles: ReturnType<typeof memoryArtworkStore>;

function buildCatalog(gateway: MtgjsonGateway = mtgjson) {
  return makeCatalog({
    unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
      catalog: drizzleCatalogRepository(transaction),
      syncRuns: drizzleSyncRunRepository(transaction),
      artwork: drizzleArtworkRepository(transaction),
    })),
    mtgjson: gateway,
    scryfall: fixtureScryfallGateway(),
    images,
    imageFetcher,
    wpn,
    artworkFiles,
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
    sql`truncate sync_runs, price_snapshots, deck_lists, sealed_products, booster_configs, printings, card_sets, artwork_files cascade`,
  );
  clock = manualClock("2026-09-27T12:00:00Z");
  mtgjson = fixtureMtgjsonGateway();
  wpn = fixtureWpnGateway();
  artworkFiles = memoryArtworkStore();
  images = inMemoryImageStore();
  imageFetcher = fakeImageFetcher();
});

describe("the first sync", () => {
  it("enables Standard sets, imports supporting sets first, and prices everything", async () => {
    const summary = await buildCatalog().runSync("prices");

    // Only paper sets are listed: YBLB (online-only Alchemy) is left out.
    expect(summary.setsInList).toBe(4);
    expect(summary.enabledAsStandard).toEqual(["BLB"]);
    // Rule 11: BLB's Commander companion set (its precons) comes with it.
    expect(summary.enabledAsCompanions).toEqual(["BLC"]);
    expect(summary.importedSupportingSets).toEqual(["SPG"]);
    expect(summary.importedSets).toEqual(["BLB", "BLC"]);
    expect(summary.failedSets).toEqual([]);
    expect(summary.leftOut).toEqual([]);
    expect(summary.skippedDigital).toEqual({
      printings: 1,
      boosterTypes: ["BLB: play-arena"],
      products: ["BLB: Bloomburrow MTGO Redemption"],
      decks: ["BLB: Bloomburrow Redemption"],
    });

    expect(await countRows("printings")).toBe(29 + 2); // Wick has no Scryfall entry: unpriced
    expect(await countRows("booster_configs")).toBe(1);
    expect(await countRows("sealed_products")).toBe(5);
    expect(await countRows("deck_lists")).toBe(2);
    expect(summary.pricedPrintings).toBe(30);
    expect(await countRows("price_snapshots")).toBe(summary.priceSnapshots);

    const sets = await db.execute<{ code: string; is_enabled: boolean; is_supporting: boolean }>(
      sql`select code, is_enabled, is_supporting from card_sets order by code`,
    );
    expect(sets.rows).toEqual([
      { code: "BLB", is_enabled: true, is_supporting: false },
      { code: "BLC", is_enabled: true, is_supporting: false },
      { code: "FDN", is_enabled: false, is_supporting: false },
      { code: "SPG", is_enabled: false, is_supporting: true },
    ]);
  });

  it("stores images and legalities from Scryfall on each printing", async () => {
    await buildCatalog().runSync("prices");
    const rows = await db.execute<{ with_images: number }>(
      sql`select count(*)::int as with_images from printings where image_uris is not null`,
    );
    expect(rows.rows[0].with_images).toBe(30);
  });

  it("prices a printing that exists only in another language, but never swaps in a translation", async () => {
    await buildCatalog().runSync("prices");
    // A (synthetic) Japanese-only Beza: Scryfall lists it only as lang "ja" (rule 8).
    const japanese = await db.execute<{ has_images: boolean; foil_cents: number | null }>(sql`
      select p.image_uris is not null as has_images,
             (select s.usd_cents from price_snapshots s
               where s.printing_id = p.id and s.finish = 'foil')::int as foil_cents
        from printings p where p.scryfall_id = '00000000-7a9a-4000-8000-0000000000bb'
    `);
    expect(japanese.rows).toEqual([{ has_images: true, foil_cents: 480 }]);
    // The Spanish copy of the English Beza has its own Scryfall id, so it matches nothing.
    expect(await countRows("printings")).toBe(31);
  });
});

describe("running again", () => {
  it("is idempotent on the same day: no duplicate printings or snapshots", async () => {
    const catalog = buildCatalog();
    const first = await catalog.runSync("prices");
    const second = await catalog.runSync("prices");
    expect(second.importedSets).toEqual([]); // already imported, same version
    expect(await countRows("printings")).toBe(31);
    expect(await countRows("price_snapshots")).toBe(first.priceSnapshots);
  });

  it("adds a new day's snapshots and keeps the old ones (ADR 0013)", async () => {
    const catalog = buildCatalog();
    const first = await catalog.runSync("prices");
    clock.advanceBy(24 * 60 * 60 * 1000);
    await catalog.runSync("prices");
    expect(await countRows("price_snapshots")).toBe(2 * first.priceSnapshots);
  });

  it("a prices run downloads no set files once they're imported; a full run re-imports them", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    mtgjson.downloads.length = 0;
    await catalog.runSync("prices");
    expect(mtgjson.downloads).toEqual([]);
    await catalog.runSync("full");
    expect(mtgjson.downloads).toEqual(["BLB", "SPG", "BLC"]);
  });
});

describe("rule 5: nothing may refer to a missing card", () => {
  it("leaves out (and reports) what refers to a supporting set that isn't available", async () => {
    const withoutSpg = fixtureMtgjsonGateway({ hideSets: ["SPG"] });
    const summary = await buildCatalog(withoutSpg).runSync("prices");
    expect(summary.importedSets).toEqual(["BLB", "BLC"]);
    expect(summary.leftOut[0]).toBe("BLB: booster play: sheet specialGuest has 2 unknown card(s)");
    expect(await countRows("booster_configs")).toBe(0);
    expect(await countRows("sealed_products")).toBe(1); // only the starter kit remains
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
    expect(runs.rows).toEqual([{ status: "succeeded", imported: '["BLB", "BLC"]' }]);
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
    const [row] = (
      await db.execute<{ id: string }>(
        sql`select id from printings where image_uris is not null limit 1`,
      )
    ).rows;
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
    const [row] = (
      await db.execute<{ id: string }>(
        sql`select id from printings where image_uris is not null limit 1`,
      )
    ).rows;
    expect(
      await catalog.imageFor({ printingId: PrintingId.of("nope"), size: "small", face: "front" }),
    ).toEqual(err({ kind: "ImageNotFound" }));
    expect(
      await catalog.imageFor({ printingId: PrintingId.of(row.id), size: "small", face: "back" }),
    ).toEqual(err({ kind: "ImageNotFound" }));
  });
});

describe("official photos, key art and details from WPN (design doc 13)", () => {
  const productId = async (name: string) =>
    (await db.execute<{ id: string }>(sql`select id from sealed_products where name = ${name}`))
      .rows[0].id;
  const links = async () =>
    (
      await db.execute<{ name: string; wpn_name: string | null; match: string; photo: string }>(sql`
        select sp.name, l.wpn_name, l.match, l.photo
          from product_wpn_links l join sealed_products sp on sp.id = l.product_id
         order by sp.name
      `)
    ).rows;

  it("reads each enabled set's page, links its products, and downloads every image", async () => {
    const summary = await buildCatalog().runSync("prices");

    expect(summary.artwork).toMatchObject({
      pagesRead: ["BLB (bloomburrow)"],
      noPage: [],
      unreadable: [],
      imageFailures: 0,
    });
    expect(wpn.pagesRead).toEqual(["bloomburrow"]); // not BLC: a Commander set has no page
    expect(await links()).toEqual([
      {
        name: "Bloomburrow Bundle",
        wpn_name: "Bloomburrow Bundle",
        match: "by_kind",
        photo: "variants",
      },
      {
        name: "Bloomburrow Play Booster Box",
        wpn_name: "Bloomburrow Play Booster Display",
        match: "by_kind",
        photo: "variants",
      },
      {
        name: "Bloomburrow Play Booster Pack",
        wpn_name: "Bloomburrow Play Booster",
        match: "by_kind",
        photo: "variants",
      },
      {
        name: "Bloomburrow Starter Kit",
        wpn_name: "Bloomburrow Starter Kit",
        match: "by_kind",
        photo: "variants",
      },
    ]); // the case is never matched
    const images = await countRows("artwork_files");
    expect(images).toBe(summary.artwork.imagesDownloaded);
    expect(artworkFiles.keys).toHaveLength(images * 2); // two sizes each
    const [page] = (
      await db.execute<{ status: string; has_key_art: boolean }>(
        sql`select status, key_art is not null as has_key_art from wpn_pages where set_code = 'BLB'`,
      )
    ).rows;
    expect(page).toEqual({ status: "found", has_key_art: true });
  });

  it("doesn't read an old set's page again on a nightly run, or download images twice", async () => {
    await buildCatalog().runSync("prices");
    const second = await buildCatalog().runSync("prices");
    expect(second.artwork.pagesRead).toEqual([]); // Bloomburrow isn't settling
    expect(second.artwork.imagesDownloaded).toBe(0);
    const full = await buildCatalog().runSync("full");
    expect(full.artwork.pagesRead).toEqual(["BLB (bloomburrow)"]);
    expect(full.artwork.imagesDownloaded).toBe(0);
  });

  it("keeps an admin's choice when the page is read again", async () => {
    const catalog = buildCatalog();
    await catalog.runSync("prices");
    const bundle = await productId("Bloomburrow Bundle");

    expect(
      await catalog.choosePhoto(admin, { productId: bundle, wpnName: null, photoIndex: null }),
    ).toEqual({ ok: true, value: undefined });
    expect(
      await catalog.choosePhoto(admin, {
        productId: bundle,
        wpnName: "Bloomburrow Bundle",
        photoIndex: 9,
      }),
    ).toEqual(err({ kind: "PhotoNotOnPage" }));
    await catalog.runSync("full");
    expect((await links()).find((link) => link.name === "Bloomburrow Bundle")).toEqual({
      name: "Bloomburrow Bundle",
      wpn_name: null,
      match: "admin",
      photo: "none",
    });

    // Undoing it links the product automatically at the next read of the page.
    await catalog.clearPhotoChoice(admin, bundle);
    await db.execute(sql`delete from sync_runs where status = 'queued'`);
    await catalog.runSync("prices");
    expect((await links()).find((link) => link.name === "Bloomburrow Bundle")?.match).toBe(
      "by_kind",
    );
  });

  it("never fails the sync over a missing or changed page (generated art stays)", async () => {
    wpn = fixtureWpnGateway({ broken: ["bloomburrow"] });
    const summary = await buildCatalog().runSync("prices");
    expect(summary.failedSets).toEqual([]);
    expect(summary.artwork.unreadable).toEqual([
      { code: "BLB", error: "the page has no embedded data" },
    ]);
    expect(await links()).toEqual([]);
  });
});
