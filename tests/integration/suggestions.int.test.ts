// Deck suggestions (design doc 20) against real Postgres and the fixture catalog, whose role tags
// and themes the sync's tag pass has stored.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  budgetList,
  deckSuggestions,
  makeDecks,
  similarCards,
  type DeckId,
  type SuggestionList,
} from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

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
    text: "Commander\n1 Beza, the Bounding Spring\nDeck\n30 Plains",
  });
  return created.value;
}

const names = (list: SuggestionList, pool: "owned" | "store") =>
  list[pool].map((suggestion) => suggestion.card.name);

describe("deck suggestions", () => {
  beforeEach(async () => {
    await give("Banishing Light");
    await give("Carrot Cake", 2);
    await give("Agate Assault"); // red: outside Beza's colors
  });

  it("knows the deck: Beza leads tokens, and every role is short", async () => {
    const suggestions = await deckSuggestions(db, jack.userId, await bezaDeck());
    expect(suggestions?.profile.themes).toEqual(["tokens"]);
    expect(suggestions?.profile.gaps.map((gap) => gap.tag)).toEqual([
      "ramp",
      "draw",
      "removal",
      "wipe",
    ]);
  });

  it("suggests your own cards first, store cards only if you don't own them, all in Beza's colors", async () => {
    const suggestions = await deckSuggestions(db, jack.userId, await bezaDeck());
    if (suggestions === null) throw new Error("Jack's deck");
    const forDeck = suggestions.forDeck;
    expect(names(forDeck, "owned").sort()).toEqual(["Banishing Light", "Carrot Cake"]);
    const owned = forDeck.owned.find((suggestion) => suggestion.card.name === "Carrot Cake");
    expect(owned?.card.owned).toBe(2);
    expect(owned?.reasons).toContainEqual({ kind: "theme", theme: "tokens" });

    const store = names(forDeck, "store");
    expect(store).toContain("Builder's Talent"); // makes tokens
    expect(store).not.toContain("Banishing Light"); // owned
    expect(store).not.toContain("Agate Assault"); // red
    expect(store).not.toContain("Wick, the Whorled Mind"); // Grixis
    expect(store).not.toContain("Beza, the Bounding Spring"); // in the deck
    expect(store).not.toContain("Plains"); // a basic land
    for (const suggestion of forDeck.store) {
      expect(suggestion.card.priceCents).not.toBeNull();
      expect(suggestion.reasons.length).toBeGreaterThan(0);
    }

    // Each short role gets its own list: removal has Banishing Light first (owned).
    const removal = suggestions.forRoles.find((role) => role.tag === "removal");
    expect(names(removal ?? { owned: [], store: [] }, "owned")).toEqual(["Banishing Light"]);
    expect(names(removal ?? { owned: [], store: [] }, "store")).toContain("Driftgloom Coyote");
  });

  it("finds cards like one, at the cheapest printing for sale", async () => {
    const deckId = await bezaDeck();
    const [crumb] = (
      await db.execute<{ oracle_id: string }>(
        sql`select oracle_id from printings where name = 'Crumb and Get It' limit 1`,
      )
    ).rows;
    const like = await similarCards(db, jack.userId, deckId, crumb.oracle_id);
    const truce = like?.store.find((suggestion) => suggestion.card.name === "Dawn's Truce");
    expect(truce?.reasons).toContainEqual({ kind: "theme", theme: "spells" });
    // Two printings of Dawn's Truce are for sale, at $14.20 and $9.56.
    expect(truce?.card.priceCents).toBe(956);
    expect(like?.store.map((suggestion) => suggestion.card.name)).not.toContain("Crumb and Get It");
  });

  it("makes a list within a budget, written for Buy a list", async () => {
    const list = await budgetList(db, jack.userId, await bezaDeck(), 100);
    if (list === null) throw new Error("Jack's deck");
    expect(list.picks.length).toBeGreaterThan(0);
    expect(list.totalCents).toBeLessThanOrEqual(100);
    expect(list.totalCents).toBe(
      list.picks.reduce((sum, pick) => sum + (pick.card.priceCents ?? 0), 0),
    );
    expect(list.picks.every((pick) => pick.card.pool === "store")).toBe(true);
    for (const line of list.listText.split("\n")) expect(line).toMatch(/^1 .+ \([A-Z0-9]+\) \S+$/);
  });

  it("refuses someone else's deck", async () => {
    await resetPlayers(["jack", "sam"]);
    const deckId = await bezaDeck();
    expect(await deckSuggestions(db, actor("sam").userId, deckId)).toBeNull();
    expect(await budgetList(db, actor("sam").userId, deckId, 500)).toBeNull();
  });
});
