// The card search (design doc 15) against real Postgres and the fixture catalog: each keyword
// family, and the same search on the three pages that use it (store, collection, deck builder).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchPrintings } from "@/modules/catalog";
import { collectionPage } from "@/modules/collection";
import { browseCollection, makeDecks } from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

const jack = actor("jack");

/** The names the singles store finds for a search, sorted (one per printing). */
async function store(search: string): Promise<string[]> {
  const result = await searchPrintings(db, {
    userId: jack.userId,
    search,
    sort: "name",
    page: 1,
  });
  expect(result.notes).toEqual([]);
  if (result.printingIds.length === 0) return [];
  const rows = await db.execute<{ name: string }>(sql`
    select name from printings where id in (${sql.join(
      result.printingIds.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  return rows.rows.map((row) => row.name).sort();
}

/** Puts copies of a printing (by set and number) in Jack's collection. */
async function give(collectorNumber: string, finish: "nonfoil" | "foil", quantity: number) {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, id, ${finish}, ${quantity} from printings
     where set_code = 'BLB' and collector_number = ${collectorNumber}`);
}

describe("card search keywords, in the singles store", () => {
  it("finds keyword abilities", async () => {
    expect(await store("kw:flying")).toEqual([
      "Lifecreed Duo",
      "Pileated Provisioner",
      "Serra Redeemer",
    ]);
    expect(await store('kw:"first strike"')).toEqual(["Brightblade Stoat"]);
  });

  it("finds exact names, and patterns in names and artists", async () => {
    expect(await store('!"Dawn\'s Truce"')).toEqual(["Dawn's Truce", "Dawn's Truce"]);
    expect(await store("!dawn")).toEqual([]);
    expect(await store("/^agate/")).toEqual(["Agate Assault", "Agate-Blade Assassin"]);
    expect(await store("a:/^rob /")).toEqual(["Nettle Guard"]);
    expect(await store('a:"rob rey"')).toEqual(["Nettle Guard"]);
  });

  it("finds treatments, borders and frames", async () => {
    expect(await store("is:showcase")).toEqual(["Dawn's Truce", "Lumra, Bellow of the Woods"]);
    expect(await store("border:borderless")).toEqual([
      "Dawn's Truce",
      "Lumra, Bellow of the Woods",
    ]);
    expect(await store("frame:extendedart")).toEqual(["Essence Channeler"]);
    expect(await store("is:fullart")).toEqual(["Plains", "Plains"]);
  });

  it("finds by mana made, price, collector number and release year", async () => {
    expect(await store("produces:w")).toEqual(["Plains", "Plains"]);
    expect(await store("usd>=100")).toEqual(["Lumra, Bellow of the Woods"]);
    expect(await store("cn<=3")).toEqual([
      "Banishing Light",
      "Beza, the Bounding Spring",
      "Brave-Kin Duo",
    ]);
    expect((await store("year=2024")).length).toBeGreaterThan(20);
    expect(await store("year<2024")).toEqual([]);
    expect(await store("date>=2024-09")).toEqual([]);
  });

  it("finds kinds of card", async () => {
    expect(await store("is:legendary t:creature")).toEqual([
      "Beza, the Bounding Spring",
      "Beza, the Bounding Spring",
      "Bria, Riptide Rogue",
      "Byrke, Long Ear of the Law",
      "Lumra, Bellow of the Woods",
      "Wick, the Whorled Mind",
    ]);
    // In the store, is:foil means "sold in foil": these two are nonfoil-only.
    expect(await store("-is:foil")).toEqual(["Colossification", "Serra Redeemer"]);
  });

  it("counts the copies you own of any printing", async () => {
    await give("2", "nonfoil", 2);
    expect(await store("own>=1")).toEqual([
      "Beza, the Bounding Spring",
      "Beza, the Bounding Spring",
    ]);
    expect(await store("own>=1 cn=2")).toEqual(["Beza, the Bounding Spring"]);
    expect(await store("own>=3")).toEqual([]);
  });

  it("notes what it ignored, and still runs the rest", async () => {
    const result = await searchPrintings(db, {
      userId: jack.userId,
      search: "kw:flying colour:u o:/(broken/",
      sort: "name",
      page: 1,
    });
    expect(result.total).toBe(3);
    expect(result.notes).toEqual([
      'Unknown keyword "colour:" (ignored)',
      "/(broken/ isn't a valid pattern (ignored)",
    ]);
  });
});

describe("the same search on every page", () => {
  it("means the same cards, and is:foil means what each page needs", async () => {
    await give("2", "nonfoil", 2); // Beza
    await give("2", "foil", 1);
    await give("20", "nonfoil", 1); // Lifecreed Duo
    const decks = makeDecks({ unitOfWork, clock });
    const created = await decks.createDeck(jack, { name: "Test", format: "casual" });
    if (!created.ok) throw new Error(created.error.kind);

    const collection = (search: string) =>
      collectionPage(db, jack.userId, { search, sections: "none", sort: "name", page: 1 });
    const builder = async (search: string) =>
      (
        await browseCollection(db, jack.userId, {
          deckId: created.value,
          search,
          colors: null,
          includeColorless: true,
          onlyLegal: false,
          sort: "name",
          page: 1,
        })
      )?.cards.map((card) => card.name) ?? [];

    expect((await collection("kw:treasure")).rows).toHaveLength(2); // the nonfoil and foil copies
    expect(await builder("kw:treasure")).toEqual(["Beza, the Bounding Spring"]);
    expect(await builder("kw:flying")).toEqual(["Lifecreed Duo"]);

    // Collection: this copy is foil. Deck builder: you own a foil of the printing shown.
    const foils = await collection("is:foil");
    expect(foils.rows.map((row) => row.finish)).toEqual(["foil"]);
    expect(await builder("is:foil")).toEqual(["Beza, the Bounding Spring"]);
  });
});
