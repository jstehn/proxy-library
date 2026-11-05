// Token proxies (design doc 25) against real Postgres and the fixture catalog: the sync stores
// tokens and links, a deck lists its tokens with your choices, and the PDF prints them.
import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  drizzleArtworkRepository,
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
  fixtureMtgjsonGateway,
  fixtureScryfallGateway,
  fixtureWpnGateway,
  memoryArtworkStore,
} from "@/modules/catalog/infrastructure";
import { makeCatalog, PrintingId } from "@/modules/catalog";
import {
  DEFAULT_PROXY_OPTIONS,
  deckTokenLines,
  makeDecks,
  makeProxySheets,
  makeTokenChoices,
  tokenArtOptions,
  type DeckId,
  type TokenLine,
  type TokenMaker,
} from "@/modules/decks";
import { pdfLibRenderer } from "@/modules/decks/infrastructure";
import { makeDrizzleUnitOfWork } from "@/shared/db";
import { err, ok } from "@/shared/kernel";
import {
  actor,
  clock,
  close,
  count,
  db,
  loadFixtureCatalog,
  resetPlayers,
  unitOfWork,
} from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "mallory"]));

const decks = makeDecks({ unitOfWork, clock });
const chooseToken = makeTokenChoices({ unitOfWork });
const jack = actor("jack");
const mallory = actor("mallory");
const TINY_JPEG = new Uint8Array(readFileSync("tests/fixtures/images/card.jpg"));

/** The fixture catalog, with an image fetcher that records what it was asked for. */
function catalogRecordingFetches() {
  const fetched: string[] = [];
  const catalog = makeCatalog({
    extraPricedPrintings: { printingIds: async () => [] },
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

/** A card's oracle id and the printing its deck line shows, by name. */
async function cardNamed(name: string): Promise<{ oracleId: string; printingId: string }> {
  const [row] = (
    await db.execute<{ oracle_id: string; id: string }>(
      sql`select oracle_id, id from printings where name = ${name} and set_code = 'BLB' limit 1`,
    )
  ).rows;
  if (row === undefined) throw new Error(`no card ${name}`);
  return { oracleId: row.oracle_id, printingId: row.id };
}

async function tokenId(name: string, setCode: string): Promise<string> {
  const [row] = (
    await db.execute<{ id: string }>(
      sql`select id from token_printings where name = ${name} and set_code = ${setCode}`,
    )
  ).rows;
  if (row === undefined) throw new Error(`no token ${name} in ${setCode}`);
  return row.id;
}

async function tokenOracleId(id: string): Promise<string> {
  const [row] = (
    await db.execute<{ oracle_id: string }>(
      sql`select oracle_id from token_printings where id = ${id}`,
    )
  ).rows;
  return row.oracle_id;
}

/** A deck of jack's with one of each named card, and its makers as the print page reads them. */
async function deckOf(names: readonly string[]) {
  const created = await decks.createDeck(jack, { name: "Tokens", format: "casual" });
  if (!created.ok) throw new Error("no deck");
  const deckId: DeckId = created.value;
  const makers: TokenMaker[] = [];
  for (const name of names) {
    const card = await cardNamed(name);
    await decks.setEntry(jack, { deckId, oracleId: card.oracleId, board: "main", quantity: 1 });
    makers.push({ ...card, name, board: "main" as const });
  }
  return { deckId, tokens: () => deckTokenLines(db, deckId, makers) };
}

const summary = (tokens: readonly TokenLine[]) =>
  tokens.map((token) =>
    `${token.name} ${token.art.setCode} ${token.included ? "" : "(out)"}`.trim(),
  );

describe("token proxies", () => {
  it("stores the fixture's paper tokens, and links from the cards that make them", async () => {
    expect(await count("token_printings")).toBe(11);
    // Beza (3 printings in the fixture with links: BLB and two promos) makes two tokens each.
    expect(await count("printing_tokens")).toBeGreaterThanOrEqual(8);
  });

  it("lists a deck's tokens by name, with each card's own set's art", async () => {
    const deck = await deckOf(["Carrot Cake", "Beza, the Bounding Spring", "Banishing Light"]);
    const tokens = await deck.tokens();
    expect(summary(tokens)).toEqual(["Fish tblb", "Rabbit tblb", "Treasure tblb"]);
    expect(tokens.find((token) => token.name === "Rabbit")?.madeBy).toEqual(["Carrot Cake"]);
  });

  it("lists every art of a token, newest first", async () => {
    const deck = await deckOf(["Carrot Cake"]);
    const [rabbit] = await deck.tokens();
    const arts = await tokenArtOptions(db, rabbit.oracleId);
    expect(arts.map((art) => art.setCode)).toEqual(["tfdn", "tblb", "tclb"]);
    expect(arts.every((art) => art.setName.length > 0)).toBe(true);
  });

  it("saves your art and leaves tokens out, for your decks only", async () => {
    const deck = await deckOf(["Carrot Cake", "Crumb and Get It"]);
    const [food, rabbit] = await deck.tokens();
    const clbRabbit = await tokenId("Rabbit", "tclb");

    expect(
      await chooseToken(jack, {
        deckId: deck.deckId,
        tokenOracleId: rabbit.oracleId,
        tokenId: clbRabbit,
        included: true,
      }),
    ).toEqual(ok());
    expect(
      await chooseToken(jack, {
        deckId: deck.deckId,
        tokenOracleId: food.oracleId,
        tokenId: null,
        included: false,
      }),
    ).toEqual(ok());
    expect(summary(await deck.tokens())).toEqual(["Food tblb (out)", "Rabbit tclb"]);

    const fish = await tokenId("Fish", "tblb");
    const refused = [
      // Someone else's deck.
      await chooseToken(mallory, {
        deckId: deck.deckId,
        tokenOracleId: rabbit.oracleId,
        tokenId: null,
        included: false,
      }),
      // A Fish isn't a Rabbit.
      await chooseToken(jack, {
        deckId: deck.deckId,
        tokenOracleId: rabbit.oracleId,
        tokenId: fish,
        included: true,
      }),
      // Nothing in this deck makes Fish.
      await chooseToken(jack, {
        deckId: deck.deckId,
        tokenOracleId: await tokenOracleId(fish),
        tokenId: null,
        included: true,
      }),
    ];
    expect(refused).toEqual([
      err({ kind: "DeckNotFound" }),
      err({ kind: "NotThatToken" }),
      err({ kind: "TokenNotInDeck" }),
    ]);
  });

  it("keeps your chosen art through the next sync", async () => {
    const deck = await deckOf(["Carrot Cake"]);
    const [rabbit] = await deck.tokens();
    const fdnRabbit = await tokenId("Rabbit", "tfdn");
    await chooseToken(jack, {
      deckId: deck.deckId,
      tokenOracleId: rabbit.oracleId,
      tokenId: fdnRabbit,
      included: true,
    });
    const { catalog } = catalogRecordingFetches();
    await catalog.runSync("prices");
    expect(summary(await deck.tokens())).toEqual(["Rabbit tfdn"]);
  });

  it("fetches a token's art crop through the card image cache", async () => {
    const { catalog, fetched } = catalogRecordingFetches();
    const rabbit = await tokenId("Rabbit", "tblb");
    const image = await catalog.imageFor({
      printingId: PrintingId.of(rabbit),
      size: "artCrop",
      face: "front",
    });
    expect(image.ok).toBe(true);
    expect(fetched).toEqual([expect.stringMatching(/\/art_crop\/front\/.*\.jpg/)]);
  });

  it("prints the tokens after the cards, in either style", async () => {
    const deck = await deckOf(["Carrot Cake", "Beza, the Bounding Spring"]);
    const tokens = await deck.tokens();
    const { catalog } = catalogRecordingFetches();
    async function cachedImage(id: string, face: "front" | "back", size: "large" | "artCrop") {
      const found = await catalog.imageFor({ printingId: PrintingId.of(id), size, face });
      return found.ok ? found.value : null;
    }
    const proxySheet = makeProxySheets({
      images: {
        image: (id, face) => cachedImage(id, face, "large"),
        artCrop: (id, face) => cachedImage(id, face, "artCrop"),
      },
      renderer: pdfLibRenderer(),
    });
    for (const style of ["scan", "playtest"] as const) {
      // 3 tokens × 4 copies: 12 cards, two pages of nine.
      const bytes = await proxySheet(
        { lines: [], tokens },
        { ...DEFAULT_PROXY_OPTIONS, style, artFilter: "edges", tokenCopies: 4 },
      );
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    }
  });
});
