// Deck suggestions (design doc 20) against real Postgres and the fixture catalog, whose role tags
// and themes the sync's tag pass has stored.
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  budgetList,
  deckSuggestions,
  deckView,
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
    expect(suggestions?.profile.themes).toEqual([
      "tokens",
      "creature-tokens",
      "artifact-tokens",
      "treasures",
    ]);
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
    expect(names(removal ?? { owned: [], store: [], hiddenOverTarget: 0 }, "owned")).toEqual([
      "Banishing Light",
    ]);
    expect(names(removal ?? { owned: [], store: [], hiddenOverTarget: 0 }, "store")).toContain(
      "Driftgloom Coyote",
    );
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

describe("a target bracket (design doc 31)", () => {
  // No Bloomburrow card is a Game Changer, so the test puts two on Wizards' list for a while.
  const GAME_CHANGERS = ["Banishing Light", "Builder's Talent"];
  const setGameChangers = (on: boolean) =>
    db.execute(sql`
      update printings set is_game_changer = ${on}
       where name in (${sql.join(
         GAME_CHANGERS.map((name) => sql`${name}`),
         sql`, `,
       )})`);

  beforeEach(async () => {
    await give("Banishing Light");
    await give("Carrot Cake", 2);
    await setGameChangers(true);
  });
  afterEach(() => setGameChangers(false));

  const everyName = (list: SuggestionList) => [...names(list, "owned"), ...names(list, "store")];

  it("leaves out Game Changers in bracket 2, says how many, and keeps them in bracket 3 (invariant 10)", async () => {
    const deckId = await bezaDeck();
    const open = await deckSuggestions(db, jack.userId, deckId);
    expect(everyName(open?.forDeck ?? emptyList)).toEqual(expect.arrayContaining(GAME_CHANGERS));
    expect(open?.forDeck.hiddenOverTarget).toBe(0);

    await decks.updateDeck(jack, { deckId, targetBracket: 2 });
    const core = await deckSuggestions(db, jack.userId, deckId);
    for (const name of GAME_CHANGERS)
      expect(everyName(core?.forDeck ?? emptyList)).not.toContain(name);
    expect(core?.forDeck.hiddenOverTarget).toBe(2);
    expect(names(core?.forDeck ?? emptyList, "owned")).toContain("Carrot Cake");

    const budget = await budgetList(db, jack.userId, deckId, 100_000);
    expect(budget?.picks.map((pick) => pick.card.name)).not.toContain("Builder's Talent");
    expect(budget?.hiddenOverTarget).toBeGreaterThan(0);

    await decks.updateDeck(jack, { deckId, targetBracket: 3 });
    const upgraded = await deckSuggestions(db, jack.userId, deckId);
    expect(everyName(upgraded?.forDeck ?? emptyList)).toEqual(
      expect.arrayContaining(GAME_CHANGERS),
    );
  });

  it("reads the target and each line's Game Changer flag in the deck view", async () => {
    const deckId = await bezaDeck();
    await decks.setEntry(jack, {
      deckId,
      oracleId: await oracleIdOf("Banishing Light"),
      board: "main",
      quantity: 1,
    });
    await decks.updateDeck(jack, { deckId, targetBracket: 2 });
    const view = await deckView(db, jack.userId, deckId);
    expect(view?.deck.targetBracket).toBe(2);
    const flagged = view?.lines.filter((line) => line.isGameChanger).map((line) => line.name);
    expect(flagged).toEqual(["Banishing Light"]);
  });

  it("only lets Commander decks have one, in the database too (invariant 8)", async () => {
    const deckId = await bezaDeck();
    await expect(
      db.execute(sql`update decks set target_bracket = 6 where id = ${deckId}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update decks set format = 'modern', target_bracket = 2 where id = ${deckId}`),
    ).rejects.toThrow();
  });
});

const emptyList: SuggestionList = { owned: [], store: [], hiddenOverTarget: 0 };

describe("60-card playset copy limits in suggestions (design doc 44)", () => {
  it("keeps owned cards under the 4-copy limit in suggestions and excludes cards once 4 copies are in main + side", async () => {
    await give("Carrot Cake", 4);
    await give("Banishing Light", 2);

    const created = await decks.createDeck(jack, { name: "Standard Tokens", format: "standard" });
    if (!created.ok) throw new Error(created.error.kind);
    await decks.importList(jack, {
      deckId: created.value,
      text: "Deck\n1 Carrot Cake\n1 Banishing Light\n24 Plains\nSideboard\n3 Carrot Cake",
    });

    const suggestions = await deckSuggestions(db, jack.userId, created.value);
    if (suggestions === null) throw new Error("expected suggestions");

    const allOwned = [
      ...suggestions.forDeck.owned,
      ...suggestions.forRoles.flatMap((role) => role.owned),
    ];
    // Carrot Cake is 1 main + 3 side = 4 (at playset cap) -> excluded.
    expect(allOwned.some((entry) => entry.card.name === "Carrot Cake")).toBe(false);

    // Banishing Light is 1 in deck out of 2 owned and cap 4 -> still suggested with inThisDeck: 1.
    const banishing = allOwned.find((entry) => entry.card.name === "Banishing Light");
    expect(banishing?.card.inThisDeck).toBe(1);
    expect(banishing?.card.owned).toBe(2);
  });
});

async function oracleIdOf(name: string): Promise<string> {
  const [row] = (
    await db.execute<{ oracle_id: string }>(
      sql`select oracle_id from printings where name = ${name} limit 1`,
    )
  ).rows;
  return row.oracle_id;
}
