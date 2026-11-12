// The LLM tools end to end (design doc 28, section 12): a real MCP client talking to the MCP
// server over the SDK's in-memory transport, against real Postgres and the fixture catalog, and
// the same tools over plain HTTP. No network.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Scope } from "@/modules/accounts";
import { buildCore } from "@/server/core";
import { loadConfig } from "@/shared/config";
import {
  actor,
  close,
  db,
  loadFixtureCatalog,
  resetPlayers,
} from "../../../tests/integration/harness";
import { makeMcpServer } from "./mcp";
import { callTool, TOOLS } from "./registry";
import type { ToolContext } from "./tool";

const core = buildCore(loadConfig());
afterAll(async () => {
  await core.close();
  await close();
});
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "amy"]));

const jack = actor("jack");
const context = (scopes: Scope[] = ["read", "decks:write", "wishlist:write"]): ToolContext => ({
  actor: jack,
  scopes,
  container: core,
});

async function connect(scopes?: Scope[]): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await makeMcpServer(context(scopes)).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

async function callRaw(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { isError: Boolean(result.isError), parsed: JSON.parse(content[0].text) };
}

/** A tool's JSON result, failing the test if the tool reported an error. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  const value = JSON.parse(content[0].text);
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(value)}`);
  return value;
}

async function give(name: string, quantity = 1): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', ${quantity} from printings p
     where p.name = ${name} order by p.collector_number limit 1
  `);
}

describe("the MCP server", () => {
  it("lists every registry tool, with instructions, resources and prompts", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    expect(client.getInstructions()).toContain("search_for_deck");
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      "proxylib://search-syntax",
      "proxylib://synergy-cookbook",
    ]);
    const syntax = await client.readResource({ uri: "proxylib://search-syntax" });
    expect(JSON.stringify(syntax)).toContain("tag:");
    const prompt = await client.getPrompt({ name: "find_synergies", arguments: { deckId: "7" } });
    expect(JSON.stringify(prompt.messages)).toContain("analyze_cards");
  });

  it("builds a deck: create, add, search for it, analyze it, read it back", async () => {
    await give("Banishing Light");
    const client = await connect();
    const created = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n10 Plains",
    });
    expect(created.added).toBe(11); // copies
    await call(client, "set_deck_entry", {
      deckId: created.deckId,
      card: "carrot cake",
      quantity: 1,
    });

    const found = await call(client, "search_for_deck", {
      deckId: created.deckId,
      queries: [
        { synergy: "Exile removal", search: "o:exile" },
        { synergy: "Enchantments", search: "t:enchantment" },
      ],
    });
    expect(found.cards[0]).toMatchObject({
      name: "Banishing Light",
      owned: 1,
      synergies: ["Exile removal", "Enchantments"],
    });
    expect(found.deck.commanderColors).toEqual(["W"]);

    const analysis = await call(client, "analyze_cards", {
      deckId: created.deckId,
      minimumCards: 1,
    });
    expect(analysis.cardCount).toBe(3);
    expect(analysis.signals.length).toBeGreaterThan(0);

    const deck = await call(client, "get_deck", { deckId: created.deckId });
    expect(deck.lines.map((line: { name: string }) => line.name).sort()).toEqual([
      "Beza, the Bounding Spring",
      "Carrot Cake",
      "Plains",
    ]);
    expect(deck.problems.length).toBeGreaterThan(0); // 12 of 100 cards
    expect(deck.list).toContain("1 Carrot Cake");
  });

  it("replaces a list only with a fresh fingerprint (rule 11)", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", { name: "Test", format: "casual" });
    const before = await call(client, "get_deck", { deckId });
    await call(client, "set_deck_entry", { deckId, card: "Plains", quantity: 4 });
    const stale = await client.callTool({
      name: "replace_deck_list",
      arguments: { deckId, list: "Deck\n2 Plains", fingerprint: before.fingerprint },
    });
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale.content)).toContain("DeckChanged");
    const fresh = await call(client, "get_deck", { deckId });
    const saved = await call(client, "replace_deck_list", {
      deckId,
      list: "Deck\n2 Plains",
      fingerprint: fresh.fingerprint,
    });
    expect(saved.cards).toBe(2);
  });

  it("finds each card once at its cheapest, and builds a list from the cheapest printings", async () => {
    // A card with two printings in the store, priced on a day after the fixture's own.
    const day = "2099-01-01";
    const [card] = (
      await db.execute<{ name: string }>(sql`
        select p.name from printings p join card_sets s on s.code = p.set_code and s.is_enabled
         group by p.name having count(*) >= 2 order by p.name limit 1
      `)
    ).rows;
    const client = await connect();
    const list = `Deck\n1 ${card.name}`;
    // A new deck each time: a card already in a deck keeps its printing when the list names none.
    const replace = async (unnamedPrinting?: string) => {
      const { deckId } = await call(client, "create_deck", { name: "Test", format: "casual" });
      const { fingerprint } = await call(client, "get_deck", { deckId });
      await call(client, "replace_deck_list", { deckId, list, fingerprint, unnamedPrinting });
      const deck = await call(client, "get_deck", { deckId, includeText: false });
      return deck.lines[0].printingId as string;
    };
    try {
      const standard = await replace("standard");
      const [cheap] = (
        await db.execute<{ id: string }>(sql`
          select p.id from printings p join card_sets s on s.code = p.set_code and s.is_enabled
           where p.name = ${card.name} and p.id <> ${standard} limit 1
        `)
      ).rows;
      await db.execute(sql`insert into price_snapshots (printing_id, finish, day, usd_cents)
                           values (${standard}, 'nonfoil', ${day}, 5000),
                                  (${cheap.id}, 'nonfoil', ${day}, 100)`);

      // The default picks the cheapest printing; "standard" keeps design doc 24's choice.
      expect(await replace()).toBe(cheap.id);
      expect(await replace("standard")).toBe(standard);

      const search = `"${card.name}"`;
      const once = await call(client, "search_cards", { search });
      const rows = once.cards.filter((row: { name: string }) => row.name === card.name);
      expect(rows).toEqual([
        expect.objectContaining({ printingId: cheap.id, cheapest: { cents: 100, text: "$1.00" } }),
      ]);
      const every = await call(client, "search_cards", { search, oneRowPerCard: false });
      expect(
        every.cards.filter((row: { name: string }) => row.name === card.name).length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await db.execute(sql`delete from price_snapshots where day = ${day}`);
    }
  });

  it("takes a long search, such as many card names at once", async () => {
    const client = await connect();
    const names = Array.from({ length: 60 }, (_, index) => `"Not A Card ${index}"`);
    const result = await call(client, "search_cards", { search: names.join(" or ") });
    expect(result.total).toBe(0);
  });

  it("refuses a tool the token's scopes don't allow (rule 3), and changes nothing", async () => {
    const client = await connect(["read"]);
    const result = await client.callTool({ name: "create_deck", arguments: { name: "Nope" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("decks:write");
    expect((await call(client, "list_decks")).decks).toEqual([]);
  });

  it("answers a deck that isn't yours with a sentence, not a crash (rule 8)", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_deck", arguments: { deckId: 999999 } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("list_decks");
  });

  it("adds, changes and removes a wish", async () => {
    const client = await connect();
    const added = await call(client, "add_wish", { card: "Banishing Light", targetPriceCents: 50 });
    expect(added.isNew).toBe(true);
    await call(client, "update_wish", { wishId: added.wishId, quantity: 2, note: "for Beza" });
    const wishlist = await call(client, "get_wishlist");
    expect(wishlist.wishes).toHaveLength(1);
    expect(wishlist.wishes[0]).toMatchObject({
      name: "Banishing Light",
      quantity: 2,
      note: "for Beza",
    });
    await call(client, "remove_wish", { wishId: added.wishId });
    expect((await call(client, "get_wishlist")).wishes).toEqual([]);
  });

  it("reports a Commander deck's bracket, saves a target, and keeps searches within it (design doc 31)", async () => {
    // No Bloomburrow card is a Game Changer: put one on the list for this test.
    await db.execute(
      sql`update printings set is_game_changer = true where name = 'Banishing Light'`,
    );
    try {
      const client = await connect();
      const { deckId } = await call(client, "create_deck", {
        name: "Beza",
        list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light",
      });
      const before = await call(client, "get_deck", { deckId, includeText: false });
      expect(before.bracket).toMatchObject({ target: null, floor: 3, gameChangers: 1 });
      expect(before.bracket.findings[0].text).toBe(
        "1 Game Changer (up to 3 in bracket 3): Banishing Light",
      );
      expect(
        before.lines.find((line: { name: string }) => line.name === "Banishing Light"),
      ).toMatchObject({ isGameChanger: true });

      expect(await call(client, "update_deck", { deckId, targetBracket: 2 })).toEqual({
        deckId,
        updated: true,
      });
      const over = await call(client, "get_deck", { deckId, includeText: false });
      expect(over.bracket.target).toBe(2);
      expect(over.bracket.overTarget).toContain("over your target of 2");

      const found = await call(client, "search_for_deck", {
        deckId,
        queries: [{ synergy: "White enchantments", search: "t:enchantment" }],
      });
      expect(found.leftOutOverTarget).toEqual(["gameChanger", "landDenial"]);

      await call(client, "update_deck", { deckId, targetBracket: 0 });
      expect((await call(client, "get_deck", { deckId })).bracket.target).toBeNull();

      const { deckId: modern } = await call(client, "create_deck", {
        name: "Modern",
        format: "modern",
      });
      const refused = await callTool(context(), "update_deck", {
        deckId: modern,
        targetBracket: 3,
      });
      expect(refused).toMatchObject({
        kind: "outcome",
        outcome: { ok: false, error: { kind: "TargetBracketNotCommander" } },
      });
      expect((await call(client, "get_deck", { deckId: modern })).bracket).toBeNull();
    } finally {
      await db.execute(
        sql`update printings set is_game_changer = false where name = 'Banishing Light'`,
      );
    }
  });

  it("reads the account, a card, sets, the guide, and the app's suggestions", async () => {
    await give("Banishing Light", 2);
    const client = await connect();
    const account = await call(client, "get_account");
    expect(account).toMatchObject({ balance: { cents: 5000, text: "$50.00" }, decks: 0 });
    expect(account.collection.copies).toBe(2);
    const card = await call(client, "get_card", { card: "banishing light" });
    expect(card.name).toBe("Banishing Light");
    expect(card.ownedOfThisPrinting).toEqual({ nonfoil: 2 });
    expect((await call(client, "list_sets")).sets.length).toBeGreaterThan(0);
    expect((await call(client, "get_search_guide", { topic: "cookbook" })).guide).toContain(
      "Treasure",
    );
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring",
    });
    const suggestions = await call(client, "suggest_for_deck", { deckId });
    expect(suggestions.profile.themes).toEqual([
      "tokens",
      "creature-tokens",
      "artifact-tokens",
      "treasures",
    ]);
    const toGet = await call(client, "cards_to_get");
    expect(toGet.cards.map((each: { name: string }) => each.name)).toEqual([
      "Beza, the Bounding Spring",
    ]);
  });
});

describe("the maybeboard and cards to cut (design doc 32)", () => {
  it("ranks possible cuts, and keeps maybeboard cards out of everything", async () => {
    await give("Banishing Light");
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n1 Carrot Cake\n10 Plains\nMaybeboard\n1 Agate Assault",
    });

    const deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Agate Assault", board: "maybe" }),
    );
    expect(deck.stats.cardCount).toBe(13); // the maybeboard isn't counted
    expect(deck.shortList).not.toContain("Agate Assault");

    const ranked = await call(client, "rank_cuts", { deckId, count: 5 });
    // Lands, the commander and the maybeboard aren't ranked.
    expect(ranked.cuts.map((cut: { name: string }) => cut.name).sort()).toEqual([
      "Banishing Light",
      "Carrot Cake",
    ]);
    for (const cut of ranked.cuts) expect(cut.why.length).toBeGreaterThan(0);
  });
});

describe("the mana base (design doc 35)", () => {
  it("plans lands to reach the target: Plains for Beza, with reasons", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n30 Plains",
    });
    const plan = await call(client, "plan_mana_base", { deckId });
    expect(plan).toMatchObject({ lands: 30, landTarget: 37, over: 0 });
    expect(plan.landTargetWhy[0]).toBe("37 is the usual count");
    expect(plan.sources).toEqual([{ color: "W", have: 30, target: 37, mostOfItInOneCost: 2 }]);
    expect(plan.add).toEqual([
      {
        name: "Plains",
        quantity: 7,
        kind: "basic",
        tapped: "never",
        why: ["a basic for white sources"],
        alsoIn: [],
      },
    ]);
  });
});

describe("commanders I can build (design doc 36)", () => {
  it("ranks owned commanders, and details one with what's missing", async () => {
    await give("Beza, the Bounding Spring");
    await give("Banishing Light");
    const client = await connect();
    const list = await call(client, "commanders_i_can_build", {});
    expect(list.found).toBe(1);
    expect(list.commanders[0]).toMatchObject({
      name: "Beza, the Bounding Spring",
      colorIdentity: "W",
      owned: true,
      price: null,
      spellsFromYourCards: "1 of 62",
      alreadyLeads: [],
    });
    expect(list.commanders[0].roles).toContainEqual({ role: "removal", have: 1, target: 8 });

    const withStore = await call(client, "commanders_i_can_build", {
      includeStore: true,
      colors: ["W"],
      limit: 50,
    });
    const store = withStore.commanders.filter((entry: { owned: boolean }) => !entry.owned);
    expect(store.length).toBeGreaterThan(0);
    for (const entry of store) expect(entry.price).not.toBeNull();

    const beza = await call(client, "commanders_i_can_build", {
      commander: "Beza, the Bounding Spring",
    });
    expect(beza.name).toBe("Beza, the Bounding Spring");
    expect(beza.cardsByRole.removal).toEqual(["Banishing Light"]);
    expect(beza.missing.note).toMatch(/estimate/);
    for (const card of beza.missing.cards) expect(card.price).not.toBeNull();

    const notOne = await client.callTool({
      name: "commanders_i_can_build",
      arguments: { commander: "Banishing Light" },
    });
    expect(notOne.isError).toBe(true);
    expect(JSON.stringify(notOne.content)).toContain("can't lead a Commander deck");
  });
});

describe("draft_deck (design doc 37)", () => {
  it("drafts owned cards first, marks store gap-fill with prices, and respects includeStore='none'", async () => {
    await give("Banishing Light");
    await give("Carrot Cake");
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza Draft",
      list: "Commander\n1 Beza, the Bounding Spring",
    });

    const ownedOnly = await call(client, "draft_deck", {
      deckId,
      includeStore: "none",
    });
    expect(ownedOnly.existingCount).toBe(1);
    expect(ownedOnly.storeAddedCount).toBe(0);
    expect(ownedOnly.storeCost).toEqual({ cents: 0, text: "$0.00" });
    expect(ownedOnly.spells.every((spell: { pool: string }) => spell.pool === "owned")).toBe(true);
    expect(ownedOnly.spells.map((spell: { name: string }) => spell.name).sort()).toEqual([
      "Banishing Light",
      "Carrot Cake",
    ]);
    expect(ownedOnly.landsToAdd).toEqual([
      expect.objectContaining({ name: "Plains", kind: "basic" }),
    ]);

    const withStore = await call(client, "draft_deck", {
      deckId,
      includeStore: "fill-gaps",
    });
    expect(withStore.storeAddedCount).toBeGreaterThan(0);
    expect(withStore.storeCost.cents).toBeGreaterThan(0);
    expect(
      withStore.spells
        .filter((spell: { pool: string }) => spell.pool === "owned")
        .map((spell: { name: string }) => spell.name)
        .sort(),
    ).toEqual(["Banishing Light", "Carrot Cake"]);

    const noCommander = await call(client, "create_deck", {
      name: "Empty Commander",
      format: "commander",
    });
    const refused = await client.callTool({
      name: "draft_deck",
      arguments: { deckId: noCommander.deckId },
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("commander");
  });
});

describe("headings (design doc 34)", () => {
  it("sets a card's heading, renames and orders headings, and writes them in the list", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nRemoval (1)\n1 Banishing Light\nDeck\n1 Carrot Cake\n10 Plains",
    });
    await call(client, "set_deck_entry", {
      deckId,
      card: "Carrot Cake",
      quantity: 1,
      heading: "Food",
    });
    let deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.deck).toMatchObject({ grouping: "custom", headings: ["Removal", "Food"] });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Carrot Cake", heading: "Food" }),
    );
    expect(deck.list).toContain("Removal (1)\n1 Banishing Light");

    await call(client, "arrange_headings", { deckId, order: ["Food", "Removal"] });
    await call(client, "arrange_headings", { deckId, from: "Removal", to: "Interaction" });
    deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.deck.headings).toEqual(["Food", "Interaction"]);

    const refused = await callTool(context(), "set_deck_entry", {
      deckId,
      card: "Plains",
      quantity: 10,
      heading: "Lands",
    });
    expect(refused).toMatchObject({
      kind: "outcome",
      outcome: { ok: false, error: { kind: "HeadingInvalid" } },
    });
  });
});

describe("plain calls (the HTTP endpoint's core)", () => {
  it("reports an unknown tool, bad input and a missing scope as problems", async () => {
    expect(await callTool(context(), "make_coffee", {})).toMatchObject({
      kind: "problem",
      problem: { kind: "UnknownTool" },
    });
    expect(await callTool(context(), "get_deck", { deckId: "seven" })).toMatchObject({
      kind: "problem",
      problem: { kind: "InvalidInput" },
    });
    expect(await callTool(context(["read"]), "add_wish", { card: "Plains" })).toMatchObject({
      kind: "problem",
      problem: { kind: "MissingScope", scope: "wishlist:write" },
    });
  });
});

describe("signing in with a token (rule 1)", () => {
  it("finds the player for a live token, and nobody once it's revoked", async () => {
    const created = await core.accounts.createAccessToken(jack, {
      name: "LM Studio",
      scopes: ["decks:write"],
    });
    if (!created.ok) throw new Error(created.error.kind);
    const header = `Bearer ${created.value.secret}`;
    expect(await core.accounts.actorFromToken(header)).toMatchObject({
      actor: { userId: jack.userId },
      scopes: ["read", "decks:write"],
    });
    await core.accounts.revokeAccessToken(jack, created.value.token.id);
    expect(await core.accounts.actorFromToken(header)).toBeNull();
  });
});

describe("line notes and snapshots (design doc 41)", () => {
  it("sets and reads line notes and saves, compares, restores, and deletes snapshots", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Notes & Snapshots",
      list: "Commander\n1 Beza, the Bounding Spring\n1 Banishing Light\n10 Plains",
    });

    await call(client, "set_deck_entry", {
      deckId,
      card: "Banishing Light",
      quantity: 1,
      note: "Clean enchantment removal",
    });

    const initial = await call(client, "get_deck", { deckId, includeText: false });

    const snap1 = await call(client, "snapshot_deck", {
      deckId,
      action: "save",
      label: "Before Carrot Cake",
    });
    expect(snap1.snapshotId).toBeGreaterThan(0);

    await call(client, "apply_changes", {
      deckId,
      save: true,
      fingerprint: initial.fingerprint,
      changes: [
        { card: "Carrot Cake", quantity: 1, note: "Lifegain + scry food" },
        { card: "Banishing Light", quantity: 0 },
      ],
    });

    let deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Carrot Cake", note: "Lifegain + scry food" }),
    );

    const listOnly = await call(client, "deck_snapshots", { deckId });
    expect(listOnly.snapshots).toHaveLength(1);
    expect(listOnly.snapshots[0]).toMatchObject({ label: "Before Carrot Cake" });

    const compared = await call(client, "deck_snapshots", {
      deckId,
      snapshotId: snap1.snapshotId,
    });
    expect(compared).toMatchObject({
      compared: {
        before: { label: "Before Carrot Cake" },
        after: { label: "Current deck" },
      },
      changes: expect.arrayContaining([
        expect.objectContaining({ card: "Banishing Light", before: 1, after: 0 }),
        expect.objectContaining({ card: "Carrot Cake", before: 0, after: 1 }),
      ]),
    });

    await call(client, "snapshot_deck", {
      deckId,
      action: "restore",
      snapshotId: snap1.snapshotId,
    });
    deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Banishing Light", note: "Clean enchantment removal" }),
    );
    expect(deck.lines.some((line: { name: string }) => line.name === "Carrot Cake")).toBe(false);

    await call(client, "snapshot_deck", {
      deckId,
      action: "delete",
      snapshotId: snap1.snapshotId,
    });
    const afterDelete = await call(client, "deck_snapshots", { deckId });
    expect(afterDelete.snapshots).toEqual([]);
  });
});

describe("token and emblem checklist (design doc 42)", () => {
  it("surfaces token and emblem checklists in get_deck and deck_tokens", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Token Checklist Test",
      format: "standard",
      list: [
        "1 Carrot Cake",
        "20 Plains",
        "Sideboard",
        "1 Crumb and Get It",
        "Maybeboard",
        "1 Beza, the Bounding Spring",
      ].join("\n"),
    });

    const deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.tokens).toMatchObject({
      summary: { total: 2, tokens: 2, emblems: 0, helpers: 0, mainboard: 1, sideboardOnly: 1 },
      items: [
        { name: "Food", kind: "token", madeBy: ["Crumb and Get It"], sideboardOnly: true },
        { name: "Rabbit", kind: "token", madeBy: ["Carrot Cake"], sideboardOnly: false },
      ],
    });

    const allTokens = await call(client, "deck_tokens", { deckId });
    expect(allTokens).toMatchObject({
      deckId,
      showing: 2,
      summary: { total: 2, tokens: 2, emblems: 0, helpers: 0, mainboard: 1, sideboardOnly: 1 },
    });
    expect(allTokens.items).toEqual([
      expect.objectContaining({
        name: "Food",
        kind: "token",
        sideboardOnly: true,
        madeBy: ["Crumb and Get It"],
        boards: ["side"],
        includedInProxies: true,
      }),
      expect.objectContaining({
        name: "Rabbit",
        kind: "token",
        sideboardOnly: false,
        madeBy: ["Carrot Cake"],
        boards: ["main"],
        includedInProxies: true,
      }),
    ]);

    const playedOnly = await call(client, "deck_tokens", { deckId, board: "played" });
    expect(playedOnly.showing).toBe(1);
    expect(playedOnly.items.map((item: { name: string }) => item.name)).toEqual(["Rabbit"]);

    const emblemsOnly = await call(client, "deck_tokens", { deckId, kind: "emblem" });
    expect(emblemsOnly.showing).toBe(0);
    expect(emblemsOnly.items).toEqual([]);
  });
});

describe("opening-hand odds (design doc 43)", () => {
  it("reports land-drop and turn-3 ramp probabilities in get_deck and opening_hand_odds", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Odds Test Deck",
      format: "standard",
      list: ["24 Plains", "4 Carrot Cake", "4 Banishing Light"].join("\n"),
    });

    const deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.openingHandOdds).toMatchObject({
      librarySize: 32,
      lands: 24,
      earlyRamp: 0,
    });
    expect(deck.openingHandOdds.threeLandsByTurn3Percent).toBeGreaterThan(90);

    const play = await call(client, "opening_hand_odds", {
      deckId,
      cardNames: ["Carrot Cake"],
      byTurn: 3,
      atLeast: 1,
    });
    const draw = await call(client, "opening_hand_odds", {
      deckId,
      onTheDraw: true,
      cardNames: ["Carrot Cake"],
      byTurn: 3,
      atLeast: 1,
    });

    expect(play).toMatchObject({
      deckId,
      librarySize: 32,
      lands: 24,
      onTheDraw: false,
      freeMulligan: false,
      rampByTurn3: { cardsSeen: 9 },
      customQuery: { cardNames: ["Carrot Cake"], matchingCopies: 4, byTurn: 3, atLeast: 1 },
    });
    expect(play.landDrops).toHaveLength(5);
    expect(draw.rampByTurn3.cardsSeen).toBe(10);
    expect(draw.customQuery.chancePercent).toBeGreaterThan(play.customQuery.chancePercent);
  });
});

describe("60-card formats (design doc 44)", () => {
  it("exposes formatRules, sideboardCount, 60-card roleTargets, cardLegalIn, and playset drafting", async () => {
    await give("Banishing Light", 4);
    await give("Carrot Cake", 4);
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Standard White Control",
      format: "standard",
      list: [
        "Deck",
        "2 Carrot Cake",
        "24 Plains",
        "Sideboard",
        "4 Banishing Light",
        "12 Plains",
      ].join("\n"),
    });

    const deck = await call(client, "get_deck", { deckId, includeText: false });
    expect(deck.stats.cardCount).toBe(26);
    expect(deck.stats.sideboardCount).toBe(16);
    expect(deck.formatRules).toEqual({
      minMainCards: 60,
      exactSize: false,
      maxCopies: 4,
      maxSideboard: 15,
    });
    expect(deck.roleTargets).toEqual({ ramp: 4, draw: 6, removal: 6, wipe: 2 });
    expect(deck.cardLegalIn).toEqual(["standard", "modern"]);
    expect(deck.problems).toEqual(
      expect.arrayContaining(["The sideboard has 16 cards; the most is 15."]),
    );

    const draft = await call(client, "draft_deck", { deckId, includeStore: "none" });
    expect(draft.totalAfterDraft).toBeLessThanOrEqual(60);
    const carrot = draft.spells.find((spell: { name: string }) => spell.name === "Carrot Cake");
    expect(carrot?.quantity).toBe(2);

    const { deckId: limitedId } = await call(client, "create_deck", {
      name: "Sealed",
      format: "limited",
    });
    const limitedDraft = await callRaw(client, "draft_deck", { deckId: limitedId });
    expect(limitedDraft.isError).toBe(true);
    expect(limitedDraft.parsed).toMatchObject({ error: { kind: "LimitedDeck" } });
  });
});
