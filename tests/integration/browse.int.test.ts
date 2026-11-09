// Browsing your collection while building a deck (design doc 14, section 2.1), against real
// Postgres and the fixture catalog.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  browseCollection,
  deckView,
  makeDecks,
  type BrowseInput,
  type DeckId,
} from "@/modules/decks";
import { PrintingId } from "@/modules/catalog";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

/** Puts copies of a card (by name) in Jack's collection, as if he had opened them. */
async function give(name: string, quantity = 1): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', ${quantity} from printings p
     where p.name = ${name} order by p.collector_number limit 1
  `);
}

async function newDeck(format: "casual" | "commander", list = ""): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name: "Test", format });
  if (!created.ok) throw new Error(created.error.kind);
  if (list !== "") await decks.importList(jack, { deckId: created.value, text: list });
  return created.value;
}

async function browse(deckId: DeckId, input: Partial<BrowseInput> = {}) {
  const page = await browseCollection(db, jack.userId, {
    deckId,
    source: "mine",
    search: "",
    colors: null,
    includeColorless: true,
    onlyLegal: true,
    sort: "name",
    page: 1,
    ...input,
  });
  if (page === null) throw new Error("not Jack's deck");
  return page;
}

const names = (page: { cards: readonly { name: string }[] }) => page.cards.map((card) => card.name);

describe("browsing the collection for a deck", () => {
  beforeEach(async () => {
    for (const name of [
      "Bria, Riptide Rogue",
      "Agate Assault",
      "Banishing Light",
      "Plains",
      "Wick, the Whorled Mind",
    ])
      await give(name, 2);
  });

  it("goes by color identity, which counts mana symbols in the rules text too", async () => {
    // Bria is blue-red. Wick costs only {3}{B} but its text has {U}{B}{R}: its identity is
    // Grixis, so a blue-red deck can't play it (and nor can it play Plains: white identity).
    const deckId = await newDeck("commander", "Commander\n1 Bria, Riptide Rogue");
    const blueRed = await browse(deckId, { colors: ["U", "R"] });
    expect(names(blueRed)).toEqual(["Agate Assault", "Bria, Riptide Rogue"]);

    const grixis = await browse(deckId, { colors: ["U", "B", "R"] });
    expect(names(grixis)).toContain("Wick, the Whorled Mind");

    // Shown anyway when asked, and marked as outside the commander's colors.
    const everything = await browse(deckId);
    const wick = everything.cards.find((card) => card.name === "Wick, the Whorled Mind");
    expect(wick).toMatchObject({ misfit: "color", owned: 2, manaCost: "{3}{B}" });
    expect(everything.cards.find((card) => card.name === "Agate Assault")?.misfit).toBeNull();
  });

  it("searches like Scryfall: colors by cost, identity by identity", async () => {
    const deckId = await newDeck("casual");
    expect(names(await browse(deckId, { search: "c:b" }))).toEqual(["Wick, the Whorled Mind"]);
    expect(names(await browse(deckId, { search: "id<=b" }))).toEqual([]);
    expect(names(await browse(deckId, { search: 'o:"sacrifice a snail"' }))).toEqual([
      "Wick, the Whorled Mind",
    ]);
    expect(names(await browse(deckId, { search: "t:legendary -c:b" }))).toEqual([
      "Bria, Riptide Rogue",
    ]);
    const typo = await browse(deckId, { search: "bria colour:u" });
    expect(names(typo)).toEqual(["Bria, Riptide Rogue"]);
    expect(typo.notes.length).toBeGreaterThan(0); // says which part it ignored
  });

  it("leaves out colorless cards when asked, and counts copies in this and other decks", async () => {
    const deckId = await newDeck("casual", "2 Agate Assault");
    await newDeck("casual", "1 Agate Assault");

    const red = await browse(deckId, { colors: ["R"], includeColorless: false });
    expect(red.cards).toEqual([
      expect.objectContaining({ name: "Agate Assault", inThisDeck: 2, otherDecks: 1 }),
    ]);
    expect(red.total).toBe(1);
  });

  it("refuses someone else's deck", async () => {
    const deckId = await newDeck("casual");
    const others = await browseCollection(db, actor("someone").userId, {
      deckId,
      source: "mine",
      search: "",
      colors: null,
      includeColorless: true,
      onlyLegal: true,
      sort: "name",
      page: 1,
    });
    expect(others).toBeNull();
  });

  it("gives each card what the builder needs to show it before the server answers (design doc 19)", async () => {
    const deckId = await newDeck("commander", "Commander\n1 Bria, Riptide Rogue");
    const page = await browse(deckId, { onlyLegal: false });
    const card = page.cards.find((candidate) => candidate.name === "Banishing Light");
    if (card === undefined) throw new Error("Banishing Light should be in the grid");

    // Add it the way the builder does, then compare its guess with the server's deck line.
    const added = await decks.setEntry(jack, {
      deckId,
      oracleId: card.oracleId,
      board: "main",
      quantity: 1,
      printingId: PrintingId.of(card.printingId),
    });
    expect(added.ok).toBe(true);
    const view = await deckView(db, jack.userId, deckId);
    const line = view?.lines.find((candidate) => candidate.oracleId === card.oracleId);
    expect(line).toMatchObject({
      printingId: card.printingId,
      finish: card.finish,
      text: card.text,
      producedMana: card.producedMana,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      priceCents: card.priceCents,
    });
    expect(card.text).toMatch(/exile target nonland permanent/i);
    const rules = view?.rules[card.oracleId];
    expect(card.rules).toMatchObject({
      name: rules?.name,
      typeLine: rules?.typeLine,
      text: rules?.text,
      colorIdentity: rules?.colorIdentity,
      isBasicLand: rules?.isBasicLand,
      hasPowerToughness: rules?.hasPowerToughness,
    });
    // Only the deck's format, as the server has it.
    expect(card.rules.legalities).toEqual({ commander: rules?.legalities.commander });
  });
});

describe("browsing every card for a deck (design doc 29)", () => {
  const all = (deckId: DeckId, input: Partial<BrowseInput> = {}) =>
    browse(deckId, { source: "all", onlyLegal: false, ...input });

  it("shows each card for sale once, owned or not, and leaves out disabled sets", async () => {
    await give("Agate Assault", 2);
    const deckId = await newDeck("casual");
    const page = await all(deckId);

    // Beza has four printings (two in a disabled promo set): one tile.
    expect(names(page).filter((name) => name === "Beza, the Bounding Spring")).toHaveLength(1);
    // Rat Colony and Toski are only in a disabled set: not for sale, not shown.
    expect(names(page)).not.toContain("Rat Colony");
    expect(names(page)).not.toContain("Toski, Bearer of Secrets");
    expect(new Set(names(page)).size).toBe(page.cards.length);
    expect(page.total).toBe(page.cards.length);

    expect(page.cards.find((card) => card.name === "Agate Assault")).toMatchObject({ owned: 2 });
    expect(page.cards.find((card) => card.name === "Banishing Light")).toMatchObject({
      owned: 0,
      ownedReal: 0,
    });
    // The owned browse still shows only your cards (rule 1).
    expect(names(await browse(deckId, { onlyLegal: false }))).toEqual(["Agate Assault"]);
  });

  it("shows a card you don't own as its standard art, nonfoil, at that printing's price", async () => {
    const deckId = await newDeck("casual");
    const truce = (await all(deckId, { search: "dawn's truce" })).cards;
    // BLB 9 rather than the borderless showcase 295 (design doc 24, rule 2).
    expect(truce).toEqual([
      expect.objectContaining({
        setCode: "BLB",
        collectorNumber: "9",
        finish: "nonfoil",
        priceCents: 982,
        owned: 0,
      }),
    ]);
    // A search that only one printing matches shows that printing (rule 3).
    const showcase = (await all(deckId, { search: "dawn's truce frame:showcase" })).cards;
    expect(showcase).toEqual([
      expect.objectContaining({ collectorNumber: "295", priceCents: 1420 }),
    ]);
  });

  it("shows a card you own as your copy, whatever the standard art is", async () => {
    await give("Dawn's Truce", 3); // gives the first by collector number: the showcase 295
    const deckId = await newDeck("casual");
    const [truce] = (await all(deckId, { search: "dawn's truce" })).cards;
    expect(truce).toMatchObject({ collectorNumber: "295", owned: 3 });
  });

  it("finds only what you're missing with own=0", async () => {
    await give("Agate Assault", 1);
    const deckId = await newDeck("casual");
    const missing = await all(deckId, { search: "own=0" });
    expect(names(missing)).not.toContain("Agate Assault");
    expect(missing.cards.every((card) => card.owned === 0)).toBe(true);
    expect(missing.total).toBe((await all(deckId)).total - 1);
  });

  it("keeps the deck's rules: a commander's colors and the fit filter", async () => {
    const deckId = await newDeck("commander", "Commander\n1 Bria, Riptide Rogue");
    const blueRed = await browse(deckId, { source: "all", colors: ["U", "R"] });
    expect(blueRed.cards.length).toBeGreaterThan(0);
    expect(
      blueRed.cards.every((card) =>
        card.rules.colorIdentity.every((color) => "UR".includes(color)),
      ),
    ).toBe(true);
    expect(blueRed.cards.every((card) => card.misfit === null)).toBe(true);
  });

  it("adds a card you don't own, and the deck counts it as short", async () => {
    const deckId = await newDeck("casual");
    const [light] = (await all(deckId, { search: '"banishing light"' })).cards;
    const added = await decks.setEntry(jack, {
      deckId,
      oracleId: light.oracleId,
      board: "main",
      quantity: 2,
      printingId: PrintingId.of(light.printingId),
    });
    expect(added.ok).toBe(true);
    const view = await deckView(db, jack.userId, deckId);
    expect(view?.lines).toEqual([
      expect.objectContaining({ oracleId: light.oracleId, quantity: 2, owned: 0 }),
    ]);
    const [again] = (await all(deckId, { search: '"banishing light"' })).cards;
    expect(again).toMatchObject({ inThisDeck: 2, owned: 0 });
  });
});
