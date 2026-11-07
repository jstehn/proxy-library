// search_for_deck's query (design doc 28, section 3.3) against real Postgres and the fixture
// catalog: the deck's rules on every query (rule 12), owned before store, merged synergies.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeDecks, searchForDeck, type DeckId } from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "amy"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

async function give(name: string, quantity = 1): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', ${quantity} from printings p
     where p.name = ${name} order by p.collector_number limit 1
  `);
}

async function bezaDeck(): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name: "Beza", format: "commander" });
  if (!created.ok) throw new Error(created.error.kind);
  await decks.importList(jack, {
    deckId: created.value,
    text: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Carrot Cake\n30 Plains",
  });
  return created.value;
}

async function search(deckId: DeckId, queries: { synergy: string; search: string }[]) {
  const result = await searchForDeck(db, jack.userId, {
    deckId,
    queries,
    where: "both",
    perQuery: 50,
    maxPriceCents: null,
  });
  if (result === null) throw new Error("Jack's deck");
  return result;
}

describe("searchForDeck", () => {
  beforeEach(async () => {
    await give("Banishing Light");
    await give("Agate Assault"); // red: outside Beza's colors
  });

  it("keeps every card within the commander's colors and out of the deck (rule 12)", async () => {
    const result = await search(await bezaDeck(), [{ synergy: "Anything", search: "" }]);
    const names = result.cards.map((card) => card.name);
    expect(names).toContain("Banishing Light");
    expect(names).not.toContain("Agate Assault");
    expect(names).not.toContain("Beza, the Bounding Spring");
    expect(names).not.toContain("Carrot Cake");
    expect(names).not.toContain("Wick, the Whorled Mind");
    expect(result.deck).toMatchObject({
      name: "Beza",
      format: "commander",
      commanderColors: ["W"],
    });
  });

  it("shows your copy first, and store cards you don't own with a price", async () => {
    const result = await search(await bezaDeck(), [
      { synergy: "Enchantments", search: "t:enchantment" },
    ]);
    const owned = result.cards.filter((card) => card.owned > 0).map((card) => card.name);
    expect(owned).toEqual(["Banishing Light"]);
    expect(result.cards[0].name).toBe("Banishing Light");
    for (const card of result.cards.filter((each) => each.owned === 0)) {
      expect(card.priceCents).not.toBeNull();
    }
  });

  it("merges the synergies a card matched, and ranks it first", async () => {
    const result = await search(await bezaDeck(), [
      { synergy: "Exile removal", search: "o:exile" },
      { synergy: "Enchantments", search: "t:enchantment" },
    ]);
    expect(result.cards[0]).toMatchObject({
      name: "Banishing Light",
      synergies: ["Exile removal", "Enchantments"],
    });
  });

  it("reports each query, with a hint for one that found nothing and the parser's notes", async () => {
    const result = await search(await bezaDeck(), [
      { synergy: "Nothing", search: "o:/zzzz/" },
      { synergy: "Bad keyword", search: "otag:pseudo-ramp t:creature" },
    ]);
    expect(result.queries[0]).toMatchObject({ found: 0, shown: 0, capped: false });
    expect(result.queries[0].hint).toMatch(/^Found nothing/);
    expect(result.queries[1].notes).toHaveLength(1);
  });

  it("is null for someone else's deck", async () => {
    const deckId = await bezaDeck();
    const result = await searchForDeck(db, actor("amy").userId, {
      deckId,
      queries: [{ synergy: "x", search: "" }],
      where: "both",
      perQuery: 10,
      maxPriceCents: null,
    });
    expect(result).toBeNull();
  });
});
