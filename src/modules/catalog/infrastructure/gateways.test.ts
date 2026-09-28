import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Fetch } from "@/shared/http";
import { diskImageStore, httpScryfallGateway } from "./gateways";

// The real Scryfall gateway and image store, with a fake fetch and a temporary folder.

const fixtureLines = readFileSync("tests/fixtures/scryfall/default-cards.jsonl");
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "catalog-test-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A fake Scryfall: bulk-data info saying the file was updated at `updatedAt`, and the file. */
function fakeScryfall(updatedAt: string) {
  const requested: string[] = [];
  const fetchFn: Fetch = async (url) => {
    requested.push(url);
    if (url.endsWith("/bulk-data/default-cards")) {
      return Response.json({
        updated_at: updatedAt,
        jsonl_download_uri: "https://data.test/cards.jsonl.gz",
      });
    }
    return new Response(gzipSync(fixtureLines));
  };
  return { fetchFn, requested };
}

describe("httpScryfallGateway", () => {
  it("downloads the bulk file only when Scryfall has a newer one, keeping just the newest", async () => {
    const first = fakeScryfall("2026-09-27T09:05:41.320+00:00");
    const gateway = httpScryfallGateway(first.fetchFn, directory);

    const download = await gateway.latestBulkFile();
    expect(download.downloaded).toBe(true);
    expect((await gateway.latestBulkFile()).downloaded).toBe(false); // same version: no download
    expect(first.requested.filter((url) => url.includes("data.test"))).toHaveLength(1);

    const newer = httpScryfallGateway(
      fakeScryfall("2026-09-28T09:05:41.000+00:00").fetchFn,
      directory,
    );
    expect((await newer.latestBulkFile()).downloaded).toBe(true);
    expect(readdirSync(join(directory, "scryfall"))).toHaveLength(1); // the older copy was removed
  });

  it("streams the gzipped JSON Lines file one card at a time", async () => {
    const gateway = httpScryfallGateway(fakeScryfall("2026-09-27T09:05:41Z").fetchFn, directory);
    const { path } = await gateway.latestBulkFile();

    const setCodes: string[] = [];
    for await (const card of gateway.readBulkFile(path)) setCodes.push(card.setCode);
    expect(setCodes).toHaveLength(32);
    expect(new Set(setCodes)).toEqual(new Set(["BLB", "SPG"]));
  });
});

describe("diskImageStore", () => {
  it("returns null for a missing image, and the bytes once saved", async () => {
    const store = diskImageStore(directory);
    const key = { size: "small" as const, scryfallId: "abc", face: "front" as const };
    expect(await store.get(key)).toBeNull();
    await store.put(key, new Uint8Array([1, 2, 3]));
    expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(readdirSync(join(directory, "small"))).toEqual(["abc-front.jpg"]); // no leftover .partial
  });
});
