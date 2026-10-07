// Playtest proxies (design doc 22) against real Postgres and the fixture catalog: what the
// catalog hands the proxy sheet, art crops fetched from the right address, and a whole PDF.
import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCatalog, printingCards, PrintingId } from "@/modules/catalog";
import {
  drizzleArtworkRepository,
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
  fixtureMtgjsonGateway,
  fixtureScryfallGateway,
  fixtureWpnGateway,
  memoryArtworkStore,
} from "@/modules/catalog/infrastructure";
import { DEFAULT_PROXY_OPTIONS, makeProxySheets, type ProxyLine } from "@/modules/decks";
import { pdfLibRenderer } from "@/modules/decks/infrastructure";
import { makeDrizzleUnitOfWork } from "@/shared/db";
import { readFileSync } from "node:fs";
import { clock, close, db, loadFixtureCatalog } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);

const TINY_JPEG = new Uint8Array(readFileSync("tests/fixtures/images/card.jpg"));

/** The catalog with an image fetcher that records what it was asked for. */
function catalogRecordingFetches() {
  const fetched: string[] = [];
  const catalog = makeCatalog({
    unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
      catalog: drizzleCatalogRepository(transaction),
      syncRuns: drizzleSyncRunRepository(transaction),
      artwork: drizzleArtworkRepository(transaction),
    })),
    mtgjson: fixtureMtgjsonGateway(),
    scryfall: fixtureScryfallGateway(),
    images: { get: async () => null, put: async () => undefined },
    imageFetcher: {
      async fetch(url) {
        fetched.push(url);
        return TINY_JPEG;
      },
    },
    wpn: fixtureWpnGateway(),
    artworkFiles: memoryArtworkStore(),
    clock,
    syncTime: { hour: 4, minute: 0 },
  });
  return { catalog, fetched };
}

async function printingIdOf(name: string, collectorNumber: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from printings where name = ${name} and collector_number = ${collectorNumber}`,
  );
  const id = rows.rows[0]?.id;
  if (id === undefined) throw new Error(`${name} isn't in the fixture catalog`);
  return id;
}

describe("playtest proxies", () => {
  it("gets each printing's set, layout, colours and mana from the catalog", async () => {
    const bria = await printingIdOf("Bria, Riptide Rogue", "379");
    const plains = await printingIdOf("Plains", "262");
    const cards = await printingCards(db, [bria, plains]);
    expect(cards.get(bria)).toMatchObject({
      setCode: "BLB",
      layout: "normal",
      colors: ["R", "U"],
      producedMana: [],
    });
    expect(cards.get(plains)).toMatchObject({ colors: [], producedMana: ["W"] });
  });

  it("fetches the art crop Scryfall lists, once, from the image cache's new size", async () => {
    const { catalog, fetched } = catalogRecordingFetches();
    const bria = await printingIdOf("Bria, Riptide Rogue", "379");
    const image = await catalog.imageFor({
      printingId: PrintingId.of(bria),
      size: "artCrop",
      face: "front",
    });
    expect(image.ok).toBe(true);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\/front\//);
  });

  it("makes a playtest PDF from catalog cards", async () => {
    const ids = await Promise.all([
      printingIdOf("Bria, Riptide Rogue", "379"),
      printingIdOf("Byrke, Long Ear of the Law", "380"),
      printingIdOf("Plains", "262"),
    ]);
    const cards = await printingCards(db, ids);
    const lines: ProxyLine[] = ids.map((id) => {
      const card = cards.get(id);
      if (card === undefined) throw new Error(`no card ${id}`);
      return {
        printingId: id,
        name: card.name,
        quantity: 2,
        board: "main",
        isBasicLand: false,
        hasBack: card.hasBackImage,
        isFoil: false,
        printed: { ...card, doubleFaced: card.hasBackImage },
      };
    });
    const proxySheet = makeProxySheets({
      images: { image: async () => TINY_JPEG, artCrop: async () => TINY_JPEG },
      renderer: pdfLibRenderer(),
    });
    for (const artFilter of ["color", "grayscale", "edges", "none"] as const) {
      const bytes = await proxySheet(lines, {
        ...DEFAULT_PROXY_OPTIONS,
        style: "playtest",
        artFilter,
      });
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
  });
});
