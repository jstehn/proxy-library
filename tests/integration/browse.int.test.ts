// Browsing your collection while building a deck (design doc 14, section 2.1), against real
// Postgres and the fixture catalog.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browseCollection, makeDecks, type BrowseInput, type DeckId } from "@/modules/decks";
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
      search: "",
      colors: null,
      includeColorless: true,
      onlyLegal: true,
      sort: "name",
      page: 1,
    });
    expect(others).toBeNull();
  });
});
