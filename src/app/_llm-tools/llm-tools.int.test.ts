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
    expect(suggestions.profile.themes).toEqual(["tokens"]);
    const toGet = await call(client, "cards_to_get");
    expect(toGet.cards.map((each: { name: string }) => each.name)).toEqual([
      "Beza, the Bounding Spring",
    ]);
  });
});

describe("the maybeboard and cards to cut (design doc 32)", () => {
  it("ranks the weakest cards, and keeps maybeboard cards out of everything", async () => {
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
