// The deck builder against real Postgres and the fixture catalog (design doc 09, section 11).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import {
  browseCollection,
  cardPrintings,
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
        { includeReal, unnamedPrinting: "standard" },
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
      source: "mine",
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
      { includeReal: false, unnamedPrinting: "standard" },
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

// Design doc 24: the standard printing for cards you don't own, Universes Within before Universes
// Beyond, no Secret Lair by default, and choosing a printing. Beza's four printings are given
// known looks here (and put back afterwards): BLB #2 plain, BLB #900 borderless, PBLB #2p and
// #2s promos.
describe("the standard printing, and choosing one", () => {
  const BEZA = "Beza, the Bounding Spring";
  // A day after every fixture price, so these are the latest.
  const DAY = "2099-01-01";
  type Look = { border_color: string; frame_version: string; promo_types: string[] };
  const LOOKS: Record<string, Look> = {
    "BLB 2": { border_color: "black", frame_version: "2015", promo_types: [] },
    "BLB 900": { border_color: "borderless", frame_version: "2015", promo_types: [] },
    "PBLB 2p": { border_color: "black", frame_version: "2015", promo_types: ["promopack"] },
    "PBLB 2s": { border_color: "black", frame_version: "2015", promo_types: ["prerelease"] },
  };
  let saved: Array<{ id: string } & Look & { frame_effects: string[]; is_full_art: boolean }> = [];
  let savedSetName = "";
  const ids: Record<string, string> = {};

  async function setLook(key: string, look: Partial<Look>) {
    const [set, number] = key.split(" ");
    const promoTypes = look.promo_types ?? LOOKS[key].promo_types;
    await db.execute(sql`
      update printings
         set border_color = ${look.border_color ?? LOOKS[key].border_color},
             frame_version = ${look.frame_version ?? LOOKS[key].frame_version},
             promo_types = ${`{${promoTypes.join(",")}}`}::text[],
             frame_effects = '{}', is_full_art = false
       where set_code = ${set} and collector_number = ${number}`);
  }

  beforeAll(async () => {
    saved = (
      await db.execute<(typeof saved)[number]>(sql`
        select id, border_color, frame_version, promo_types, frame_effects, is_full_art
          from printings where name = ${BEZA}`)
    ).rows;
    savedSetName = (
      await db.execute<{ name: string }>(sql`select name from card_sets where code = 'BLB'`)
    ).rows[0].name;
    for (const key of Object.keys(LOOKS)) {
      const [set, number] = key.split(" ");
      ids[key] = (
        await db.execute<{ id: string }>(
          sql`select id from printings where set_code = ${set} and collector_number = ${number}`,
        )
      ).rows[0].id;
    }
  });
  beforeEach(async () => {
    for (const key of Object.keys(LOOKS)) await setLook(key, {});
    await db.execute(sql`update card_sets set name = ${savedSetName} where code = 'BLB'`);
  });
  afterAll(async () => {
    for (const row of saved) {
      await db.execute(sql`
        update printings
           set border_color = ${row.border_color}, frame_version = ${row.frame_version},
               promo_types = ${`{${row.promo_types.join(",")}}`}::text[],
               frame_effects = ${`{${row.frame_effects.join(",")}}`}::text[],
               is_full_art = ${row.is_full_art}
         where id = ${row.id}`);
    }
    await db.execute(sql`update card_sets set name = ${savedSetName} where code = 'BLB'`);
  });

  async function own(key: string, finish: string) {
    await db.execute(sql`insert into collection_cards (user_id, printing_id, finish, quantity)
                         values ('jack', ${ids[key]}, ${finish}, 1)`);
  }
  /** What a pasted line and the deck view pick for Beza. */
  async function picks() {
    const resolved = (
      await drizzleCardLookup(db).resolve(
        jack.userId,
        [{ name: BEZA, setCode: null, collectorNumber: null }],
        { includeReal: false, unnamedPrinting: "standard" },
      )
    ).get(0);
    const deckId = await newDeck();
    await decks.setEntry(jack, {
      deckId,
      oracleId: resolved?.oracleId ?? "",
      board: "main",
      quantity: 1,
    });
    const view = await deckView(db, jack.userId, deckId);
    return { resolved: resolved?.printingId, deckView: view?.lines[0]?.printingId };
  }
  const both = (key: string) => ({ resolved: ids[key], deckView: ids[key] });

  it("shows the standard printing of a card you don't own, not a borderless or promo one", async () => {
    expect(await picks()).toEqual(both("BLB 2"));
  });

  it("puts Universes Within before Universes Beyond", async () => {
    await setLook("BLB 2", { promo_types: ["universesbeyond"] });
    // The borderless one isn't ordinary, but it's Magic's own and from the expansion.
    expect(await picks()).toEqual(both("BLB 900"));
  });

  it("never picks Secret Lair by default, unless there's nothing else", async () => {
    await db.execute(sql`update card_sets set name = 'Secret Lair Drop' where code = 'BLB'`);
    expect(await picks()).toEqual(both("PBLB 2p"));
  });

  it("doesn't show an upcoming set's preview while a released printing exists", async () => {
    const [{ release_date: released }] = (
      await db.execute<{ release_date: string }>(
        sql`select release_date from card_sets where code = 'BLB'`,
      )
    ).rows;
    try {
      await db.execute(sql`update card_sets set release_date = '2999-01-01' where code = 'BLB'`);
      expect(await picks()).toEqual(both("PBLB 2p"));
    } finally {
      await db.execute(sql`update card_sets set release_date = ${released} where code = 'BLB'`);
    }
  });

  it("leaves old frames for when there's no modern one", async () => {
    await setLook("BLB 2", { frame_version: "1997" });
    // BLB #900 and the promos aren't ordinary either; the expansion comes first.
    expect(await picks()).toEqual(both("BLB 2"));
    await setLook("PBLB 2p", { promo_types: [] });
    expect(await picks()).toEqual(both("PBLB 2p"));
  });

  it("ranks your copies value first, then Universes Within before Universes Beyond", async () => {
    await own("BLB 2", "nonfoil");
    await own("BLB 900", "foil");
    const price = (key: string, finish: string, cents: number) =>
      db.execute(sql`insert into price_snapshots (printing_id, finish, day, usd_cents)
                     values (${ids[key]}, ${finish}, ${DAY}, ${cents})`);
    try {
      // At equal value the foil wins (design doc 23)…
      await price("BLB 2", "nonfoil", 500);
      await price("BLB 900", "foil", 500);
      expect(await picks()).toEqual(both("BLB 900"));
      // …unless it's Universes Beyond…
      await setLook("BLB 900", { promo_types: ["universesbeyond"] });
      expect(await picks()).toEqual(both("BLB 2"));
      // …but value still comes first.
      await db.execute(sql`update price_snapshots set usd_cents = 900
                            where day = ${DAY} and printing_id = ${ids["BLB 900"]}`);
      expect(await picks()).toEqual(both("BLB 900"));
    } finally {
      await db.execute(sql`delete from price_snapshots where day = ${DAY}`);
    }
  });

  it("lists every printing for the picker: yours first, then standard first", async () => {
    await own("PBLB 2s", "foil");
    const deckId = await newDeck();
    const printings = await cardPrintings(db, jack.userId, deckId, await oracleOf(BEZA));
    expect(printings.map((p) => `${p.setCode} ${p.collectorNumber}`)).toEqual([
      "PBLB 2s",
      "BLB 2",
      "BLB 900",
      "PBLB 2p",
    ]);
    expect(printings[0]).toMatchObject({ owned: 1, labels: ["Promo"] });
    expect(printings[0].finishes.find((f) => f.finish === "foil")).toMatchObject({ owned: 1 });
    expect(printings[2].labels).toEqual(["Borderless"]);
    // Someone else's deck: nothing.
    expect(await cardPrintings(db, UserId.of("mallory"), deckId, await oracleOf(BEZA))).toEqual([]);
  });

  it("pins a chosen printing and finish, and unpins it again", async () => {
    const deckId = await newDeck();
    const oracleId = await oracleOf(BEZA);
    await decks.setEntry(jack, { deckId, oracleId, board: "main", quantity: 1 });
    const line = { deckId, oracleId, board: "main" } as const;

    const pinned = await decks.choosePrinting(jack, {
      ...line,
      pinned: { printingId: PrintingId.of(ids["BLB 900"]), finish: "foil" },
    });
    expect(pinned.ok).toBe(true);
    let view = await deckView(db, jack.userId, deckId);
    expect(view?.lines[0]).toMatchObject({
      printingId: ids["BLB 900"],
      finish: "foil",
      pinnedPrintingId: ids["BLB 900"],
      quantity: 1,
    });

    expect(
      await decks.choosePrinting(jack, {
        ...line,
        pinned: { printingId: PrintingId.of(ids["BLB 900"]), finish: "nonfoil" },
      }),
    ).toEqual({ ok: false, error: { kind: "FinishNotAvailable" } });

    await decks.choosePrinting(jack, { ...line, pinned: null });
    view = await deckView(db, jack.userId, deckId);
    expect(view?.lines[0]).toMatchObject({ printingId: ids["BLB 2"], pinnedPrintingId: null });
  });
});

async function oracleOf(name: string): Promise<string> {
  const [row] = (
    await db.execute<{ oracle_id: string }>(
      sql`select oracle_id from printings where name = ${name} limit 1`,
    )
  ).rows;
  return row.oracle_id;
}
