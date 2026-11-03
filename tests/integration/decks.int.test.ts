// The deck builder against real Postgres and the fixture catalog (design doc 09, section 11).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import {
  browseCollection,
  deckProblems,
  deckView,
  decksFor,
  fingerprint,
  makeDecks,
  type DeckId,
} from "@/modules/decks";
import { drizzleCardLookup } from "@/modules/decks/infrastructure";
import { makeStore } from "@/modules/store";
import { UserId } from "@/shared/kernel";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);

const decks = makeDecks({ unitOfWork, clock });
const store = makeStore({ unitOfWork, clock });
const jack = actor("jack");

/** A priced nonfoil printing from the fixture set, and its name. */
async function card(): Promise<{ id: PrintingId; name: string }> {
  const [row] = (
    await db.execute<{ id: string; name: string }>(sql`
      select p.id, p.name from printings p
        join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
       where p.set_code = 'BLB' and p.rarity = 'common' and p.type_line not like 'Basic%'
       order by s.usd_cents, p.id limit 1
    `)
  ).rows;
  return { id: PrintingId.of(row.id), name: row.name };
}

beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

async function newDeck(): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name: "Test", format: "casual" });
  if (!created.ok) throw new Error(created.error.kind);
  return created.value;
}

describe("decks", () => {
  it("counts what a deck is short, as copies are bought and sold (shared ownership)", async () => {
    const { id: printingId, name } = await card();
    const deckId = await newDeck();
    const report = await decks.importList(jack, { deckId, text: `3 ${name}\n20 Plains` });
    expect(report.ok && report.value.notFound).toEqual([]);

    const shortBy = async () => (await decksFor(db, jack.userId))[0].short;
    expect(await shortBy()).toBe(3); // Plains is a basic land: never short

    await store.buySingle(jack, { printingId, finish: "nonfoil", quantity: 2 });
    expect(await shortBy()).toBe(1);
    await store.sellSingle(jack, { printingId, finish: "nonfoil", quantity: 1 });
    expect(await shortBy()).toBe(2);
  });

  it("shows each line with its owned count, the other decks using it, and the rules", async () => {
    const { id: printingId, name } = await card();
    await store.buySingle(jack, { printingId, finish: "nonfoil", quantity: 1 });
    const first = await newDeck();
    const second = await newDeck();
    await decks.updateDeck(jack, { deckId: second, name: "Second" });
    for (const deckId of [first, second])
      await decks.importList(jack, { deckId, text: `1 ${name}` });

    const view = await deckView(db, jack.userId, first);
    if (view === null) throw new Error("no deck");
    expect(view.lines).toEqual([
      expect.objectContaining({ name, quantity: 1, owned: 1, otherDecks: ["Second"], printingId }),
    ]);
    // The importer pinned the printing Jack owns.
    const owned = (oracleId: string) =>
      view.lines.find((line) => line.oracleId === oracleId)?.owned ?? 0;
    expect(deckProblems(view.deck, (oracleId) => view.rules[oracleId], owned)).toEqual([]);
    expect(await deckView(db, UserId.of("someone-else"), first)).toBeNull();
  });
});

// Design doc 23, section 14: a deck shows and adds your most special copy. Beza, the Bounding
// Spring has four printings in the fixtures: BLB #2 (nonfoil, foil), BLB #900 (foil), and the
// Bloomburrow promos #2p (promo pack) and #2s (prerelease, foil only).
describe("your most special copy", () => {
  const BEZA = "Beza, the Bounding Spring";
  // A day after every fixture price, so these are the latest; removed after each test.
  const DAY = "2099-01-01";

  async function printing(setCode: string, number: string): Promise<string> {
    const [row] = (
      await db.execute<{ id: string }>(
        sql`select id from printings where set_code = ${setCode} and collector_number = ${number}`,
      )
    ).rows;
    return row.id;
  }
  async function own(id: string, finish: string, quantity: number, real = false) {
    await (real
      ? db.execute(sql`insert into real_cards (user_id, printing_id, finish, quantity, added_at, updated_at)
                       values ('jack', ${id}, ${finish}, ${quantity}, now(), now())`)
      : db.execute(sql`insert into collection_cards (user_id, printing_id, finish, quantity)
                       values ('jack', ${id}, ${finish}, ${quantity})`));
  }
  async function price(id: string, finish: string, cents: number) {
    await db.execute(sql`insert into price_snapshots (printing_id, finish, day, usd_cents)
                         values (${id}, ${finish}, ${DAY}, ${cents})`);
  }
  /** What each of the three places would pick: a pasted line, the builder grid, the deck view. */
  async function picks(text: string, includeReal = false) {
    const resolved = (
      await drizzleCardLookup(db).resolve(
        jack.userId,
        [{ name: BEZA, setCode: null, collectorNumber: null }],
        { includeReal },
      )
    ).get(0);
    const deckId = await newDeck();
    await decks.updateDeck(jack, { deckId, usesRealCards: includeReal });
    await decks.setEntry(jack, {
      deckId,
      oracleId: resolved?.oracleId ?? "",
      board: "main",
      quantity: 1,
    });
    const view = await deckView(db, jack.userId, deckId);
    const grid = await browseCollection(db, jack.userId, {
      deckId,
      search: text,
      colors: null,
      includeColorless: true,
      onlyLegal: false,
      sort: "name",
      page: 1,
    });
    return {
      resolved: [resolved?.printingId, resolved?.finish],
      deckView: [view?.lines[0]?.printingId, view?.lines[0]?.finish],
      grid: [grid?.cards[0]?.printingId, grid?.cards[0]?.finish],
    };
  }
  const everywhere = (id: string, finish: string) => ({
    resolved: [id, finish],
    deckView: [id, finish],
    grid: [id, finish],
  });

  beforeEach(() => db.execute(sql`delete from price_snapshots where day = ${DAY}`));
  afterAll(() => db.execute(sql`delete from price_snapshots where day = ${DAY}`));

  it("prefers the most expensive copy, even over a foil", async () => {
    const plain = await printing("BLB", "2");
    await own(plain, "nonfoil", 3);
    await own(plain, "foil", 1);
    await price(plain, "nonfoil", 4000);
    await price(plain, "foil", 200);
    expect(await picks(BEZA)).toEqual(everywhere(plain, "nonfoil"));
  });

  it("with equal prices, prefers a foil, then a special frame (a promo)", async () => {
    const plain = await printing("BLB", "2");
    const promo = await printing("PBLB", "2p");
    await own(plain, "nonfoil", 4);
    await own(plain, "foil", 1);
    await price(plain, "nonfoil", 500);
    await price(plain, "foil", 500);
    expect(await picks(BEZA)).toEqual(everywhere(plain, "foil"));

    await own(promo, "foil", 1);
    await price(promo, "foil", 500);
    expect(await picks(BEZA)).toEqual(everywhere(promo, "foil"));
  });

  it("counts real copies only in a deck that uses them", async () => {
    const plain = await printing("BLB", "2");
    const prerelease = await printing("PBLB", "2s");
    await own(plain, "nonfoil", 1);
    await own(prerelease, "foil", 1, true);
    await price(plain, "nonfoil", 100);
    await price(prerelease, "foil", 900);
    expect((await picks(BEZA, false)).resolved).toEqual([plain, "nonfoil"]);
    expect(await picks(BEZA, true)).toEqual(everywhere(prerelease, "foil"));
  });

  it("uses the printing a line names, and says it found it", async () => {
    const plain = await printing("BLB", "2");
    const promo = await printing("PBLB", "2p");
    await own(promo, "foil", 1);
    const found = await drizzleCardLookup(db).resolve(
      jack.userId,
      [
        { name: BEZA, setCode: "BLB", collectorNumber: "2" },
        { name: BEZA, setCode: "ZZZ", collectorNumber: "1" },
      ],
      { includeReal: false },
    );
    expect(found.get(0)).toMatchObject({
      printingId: plain,
      finish: "nonfoil",
      namedPrinting: true,
    });
    // A set that doesn't have the card: your most special copy instead, not "named".
    expect(found.get(1)).toMatchObject({ printingId: promo, finish: "foil", namedPrinting: false });
  });

  it("replaces a list, keeping pinned printings and using your special copy for new cards", async () => {
    const plain = await printing("BLB", "2");
    const promo = await printing("PBLB", "2p");
    const { name: other } = await card();
    await own(promo, "foil", 1);
    const deckId = await newDeck();
    await decks.importList(jack, { deckId, text: `2 ${other}` });

    const before = await deckView(db, jack.userId, deckId);
    if (before === null) throw new Error("no deck");
    const result = await decks.replaceList(jack, {
      deckId,
      text: `Commander (1)\n1 ${BEZA}\nOther things (3)\n3 ${other}\n1 Plains`,
      // As the deck page computes it, from the read model's lines.
      fingerprint: fingerprint(
        before.lines.map((line) => ({
          ...line,
          printingId: line.pinnedPrintingId,
          finish: line.pinnedFinish,
        })),
      ),
    });
    expect(result).toEqual({ ok: true, value: { cards: 5 } });
    const after = await deckView(db, jack.userId, deckId);
    const line = (name: string) => after?.lines.find((each) => each.name === name);
    expect(line(BEZA)).toMatchObject({ board: "commander", printingId: promo, finish: "foil" });
    expect(line(other)).toMatchObject({ quantity: 3, printingId: before.lines[0].printingId });
    expect(line("Plains")).toMatchObject({ quantity: 1 });
    expect(plain).not.toBe(promo);
  });
});
