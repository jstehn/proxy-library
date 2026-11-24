// The LLM tools end to end (design doc 28, section 12): a real MCP client talking to the MCP
// server over the SDK's in-memory transport, against real Postgres and the fixture catalog, and
// the same tools over plain HTTP. No network.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allows, type Scope } from "@/modules/accounts";
import { buildCore } from "@/server/composition/core";
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
  allows: (scope) => allows(scopes, scope),
  capabilities: core.capabilities,
  reads: core.reads,
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

/** Saves one change to a deck through edit_deck, reading the fingerprint first. */
async function saveChange(
  client: Client,
  deckId: number,
  change: Record<string, unknown>,
): Promise<void> {
  const { fingerprint } = await call(client, "get_deck", { deckId });
  await call(client, "edit_deck", { deckId, save: true, fingerprint, changes: [change] });
}

describe("the MCP server", () => {
  it("lists every registry tool, with instructions, resources and prompts", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    expect(client.getInstructions()).toContain("search_cards");
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      "proxylib://search-syntax",
      "proxylib://synergy-cookbook",
    ]);
    const syntax = await client.readResource({ uri: "proxylib://search-syntax" });
    expect(JSON.stringify(syntax)).toContain("tag:");
    const prompt = await client.getPrompt({ name: "find_synergies", arguments: { deckId: "7" } });
    expect(JSON.stringify(prompt.messages)).toContain("get_deck");
  });

  it("builds a deck: create, add, search for it, analyze it, read it back", async () => {
    await give("Banishing Light");
    const client = await connect();
    const created = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n10 Plains",
    });
    expect(created.added).toBe(11); // copies
    await saveChange(client, created.deckId, { card: "carrot cake", quantity: 1 });

    const found = await call(client, "search_cards", {
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

    const deckWithSignals = await call(client, "get_deck", {
      deckId: created.deckId,
      include: ["signals"],
      view: "full",
    });
    expect(deckWithSignals.signals.cardCount).toBe(3);
    expect(deckWithSignals.signals.signals.length).toBeGreaterThan(0);

    const deck = deckWithSignals;
    expect(deck.lines.map((line: { name: string }) => line.name).sort()).toEqual([
      "Beza, the Bounding Spring",
      "Carrot Cake",
      "Plains",
    ]);
    expect(deck.problems.length).toBeGreaterThan(0); // 12 of 100 cards
    expect(deck.list).toContain("1 Carrot Cake");
  });

  it("reads a deck compactly by default: one line per card with text, details on request", async () => {
    const client = await connect();
    await give("Banishing Light");
    const created = await call(client, "create_deck", {
      name: "Compact",
      list: "Commander\n1 Beza, the Bounding Spring\n\nDeck\n1 Banishing Light\n3 Plains\n\nMaybeboard\n1 Carrot Cake",
    });
    const deck = await call(client, "get_deck", { deckId: created.deckId });
    expect(deck.deck).toMatchObject({
      format: "commander",
      commander: ["Beza, the Bounding Spring"],
    });
    expect(deck.fingerprint).toEqual(expect.any(String));
    expect(deck.lines).toBeUndefined();
    const allLines: string[] = Object.values(deck.cards as Record<string, string[]>).flat();
    expect(deck.cards.Commander[0]).toMatch(/^1 Beza, the Bounding Spring · /);
    expect(allLines.find((line) => line.includes("Banishing Light"))).toBe(
      "1 Banishing Light · {2}{W} · Enchantment",
    );
    const withText = await call(client, "get_deck", {
      deckId: created.deckId,
      includeText: true,
    });
    const textLines: string[] = Object.values(withText.cards as Record<string, string[]>).flat();
    expect(textLines.find((line) => line.includes("Banishing Light"))).toMatch(/ — .*exile/i);
    expect(allLines.find((line) => line.includes("Plains"))).toBe("3 Plains · Basic Land — Plains");
    expect(deck.maybe).toEqual(["Carrot Cake"]);
    expect(deck.deck.shortTotal).toBeGreaterThan(0);
    expect(deck.short).toBeUndefined();
    expect(deck.prices).toBeUndefined();

    const withPrices = await call(client, "get_deck", {
      deckId: created.deckId,
      text: false,
      include: ["prices", "ids", "short"],
    });
    expect(withPrices.short.cards.some((card: string) => card.startsWith("Beza"))).toBe(true);
    expect(
      Object.values(withPrices.cards as Record<string, string[]>)
        .flat()
        .join("\n"),
    ).not.toMatch(/exile/i);
    expect(withPrices.prices.cards["Banishing Light"]).toMatch(/^\$/);
    expect(withPrices.ids["Banishing Light"]).toMatchObject({ oracleId: expect.any(String) });

    const detail = await call(client, "get_deck", {
      deckId: created.deckId,
      cards: ["banishing light", "Sol Ring"],
    });
    expect(detail.cards).toHaveLength(1);
    expect(detail.cards[0]).toMatchObject({ name: "Banishing Light", owned: 1 });
    expect(detail.notInDeck).toEqual(["Sol Ring"]);
  });

  it("keeps a card's role and pin through later edits and shows them in get_deck", async () => {
    const client = await connect();
    const created = await call(client, "create_deck", {
      name: "Roles",
      list: "Commander\n1 Beza, the Bounding Spring\n\nDeck\n1 Banishing Light\n3 Plains",
    });
    const deckId = created.deckId;
    const { fingerprint } = await call(client, "get_deck", { deckId });
    await call(client, "edit_deck", {
      deckId,
      save: true,
      fingerprint,
      changes: [{ card: "Banishing Light", role: "Answers anything for {2}{W}", pinned: true }],
    });
    // A later edit to another card saves the whole deck again: the role and pin must survive it.
    const after = await call(client, "get_deck", { deckId });
    await call(client, "edit_deck", {
      deckId,
      save: true,
      fingerprint: after.fingerprint,
      changes: [{ card: "Plains", quantity: 4 }],
    });
    const deck = await call(client, "get_deck", { deckId });
    const line = Object.values(deck.cards as Record<string, string[]>)
      .flat()
      .find((entry) => entry.includes("Banishing Light"));
    expect(line).toContain("PINNED");
    expect(line).toContain("role: Answers anything for {2}{W}");
    const detail = await call(client, "get_deck", { deckId, cards: ["Banishing Light"] });
    expect(detail.cards[0]).toMatchObject({ role: "Answers anything for {2}{W}", pinned: true });
  });

  it("reads and edits the whole primer through the tools: profile, sections, roles and pins", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Primer",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n10 Plains",
    });
    await call(client, "update_deck", {
      deckId,
      plan: "Go wide with tokens.",
      keyCards: [{ cardName: "Banishing Light", reason: "the only removal" }],
      avoid: [{ cardName: "Carrot Cake", reason: "too slow" }],
    });
    await call(client, "update_deck", {
      deckId,
      primerSection: "Plan",
      primerContent: "Make [[Beza, the Bounding Spring]] happy.",
    });
    await call(client, "update_deck", {
      deckId,
      primerSection: "Mulligan",
      primerContent: "Keep 3 lands.",
    });
    await saveChange(client, deckId, { card: "Plains", role: "Mana", pinned: true });

    await call(client, "update_deck", { deckId, primerSection: "Mulligan", primerContent: "" });
    const full = await call(client, "get_deck", { deckId, include: ["primer"] });
    expect(full.primer).toBe("## Plan\n\nMake [[Beza, the Bounding Spring]] happy.");
    expect(full.profileSummary).toContain("Go wide with tokens.");
  });

  it("replaces a list only with a fresh fingerprint (rule 11)", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", { name: "Test", format: "casual" });
    const before = await call(client, "get_deck", { view: "full", deckId });
    await saveChange(client, deckId, { card: "Plains", quantity: 4 });
    const stale = await client.callTool({
      name: "edit_deck",
      arguments: { deckId, list: "Deck\n2 Plains", fingerprint: before.fingerprint },
    });
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale.content)).toContain("DeckChanged");
    const fresh = await call(client, "get_deck", { view: "full", deckId });
    const saved = await call(client, "edit_deck", {
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
      const { fingerprint } = await call(client, "get_deck", { view: "full", deckId });
      await call(client, "edit_deck", { deckId, list, fingerprint, unnamedPrinting });
      const deck = await call(client, "get_deck", { view: "full", deckId });
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
      const once = await call(client, "search_cards", { search, includePrice: true });
      const rows = once.cards.filter((row: { name: string }) => row.name === card.name);
      expect(rows).toEqual([expect.objectContaining({ name: card.name, priceCents: 100 })]);
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

  it("adds, changes and removes wishes", async () => {
    const client = await connect();
    const addedRes = await call(client, "manage_wishlist", {
      action: "add",
      wishes: [{ card: "Banishing Light", targetPriceCents: 50 }],
    });
    expect(addedRes.added[0].isNew).toBe(true);
    const wishId = addedRes.added[0].wishId;
    await call(client, "manage_wishlist", {
      action: "add",
      wishes: [{ card: "Banishing Light", quantity: 2, note: "for Beza" }],
    });
    const wishlist = await call(client, "manage_wishlist", { action: "list" });
    expect(wishlist.wishes).toHaveLength(1);
    expect(wishlist.wishes[0]).toMatchObject({
      name: "Banishing Light",
      quantity: 2,
      note: "for Beza",
    });
    await call(client, "manage_wishlist", { action: "remove", wishIds: [wishId] });
    expect((await call(client, "manage_wishlist", { action: "list" })).wishes).toEqual([]);
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
      const before = await call(client, "get_deck", { view: "full", deckId, includeText: false });
      expect(before.bracket).toMatchObject({ target: null, floor: 3, gameChangers: 1 });
      expect(before.bracket.findings[0].text).toBe(
        "1 Game Changer (up to 3 in bracket 3): Banishing Light",
      );
      expect(
        before.lines.find((line: { name: string }) => line.name === "Banishing Light"),
      ).toMatchObject({ isGameChanger: true });

      expect(await call(client, "update_deck", { deckId, targetBracket: 2 })).toEqual({
        deckId,
        metadataUpdated: true,
      });
      const over = await call(client, "get_deck", { view: "full", deckId, includeText: false });
      expect(over.bracket.target).toBe(2);
      expect(over.bracket.overTarget).toContain("over your target of 2");

      const found = await call(client, "search_cards", {
        deckId,
        queries: [{ synergy: "White enchantments", search: "t:enchantment" }],
      });
      expect(found.leftOutOverTarget).toEqual(["gameChanger", "landDenial"]);

      await call(client, "update_deck", { deckId, targetBracket: 0 });
      expect((await call(client, "get_deck", { view: "full", deckId })).bracket.target).toBeNull();

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
      expect((await call(client, "get_deck", { view: "full", deckId: modern })).bracket).toBeNull();
    } finally {
      await db.execute(
        sql`update printings set is_game_changer = false where name = 'Banishing Light'`,
      );
    }
  });

  it("reads the account and a card", async () => {
    await give("Banishing Light", 2);
    const client = await connect();
    const account = await call(client, "get_account");
    expect(account).toMatchObject({ balance: 5000, decks: 0 });
    expect(account.collection.copies).toBe(2);
    const cardsRes = await call(client, "get_cards", {
      cards: ["banishing light"],
      detail: "compact",
    });
    expect(cardsRes.cards[0].name).toBe("Banishing Light");
    expect(cardsRes.cards[0].ownedGame).toBe(2);
  });
});

describe("the maybeboard and disabled cut suggestions", () => {
  it("keeps maybeboard cards out of deck stats and omits rank_cuts, suggest_swaps, and deck_facts topCuts", async () => {
    await give("Banishing Light");
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n1 Carrot Cake\n10 Plains\nMaybeboard\n1 Agate Assault",
    });

    const deck = await call(client, "get_deck", { view: "full", deckId, includeText: false });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Agate Assault", board: "maybe" }),
    );
    expect(deck.stats.cardCount).toBe(13); // the maybeboard isn't counted
    expect(deck.shortList).not.toContain("Agate Assault");
    expect(typeof deck.stats.costToComplete).toBe("number");
    expect(deck.toComplete.missingCopies).toBe(2);
    expect(deck.toComplete.total).toEqual(deck.stats.costToComplete);
    expect(deck.toComplete.cards.map((c: { name: string }) => c.name).sort()).toEqual([
      "Beza, the Bounding Spring",
      "Carrot Cake",
    ]);
    for (const card of deck.toComplete.cards) {
      expect(card.missing).toBe(1);
      expect(card.owned).toBe(0);
      expect(card).toHaveProperty("price");
      expect(card).toHaveProperty("subtotal");
    }
    expect(deck.toComplete.maybeboard).toEqual([
      expect.objectContaining({
        name: "Agate Assault",
        quantity: 1,
        owned: 0,
        missing: 1,
      }),
    ]);
    expect(deck.toComplete.maybeboard[0]).toHaveProperty("price");

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).not.toContain("rank_cuts");
    expect(names).not.toContain("suggest_swaps");
    expect(names).not.toContain("goldfish_start");
    expect(names).not.toContain("goldfish_step");

    const deckWithFacts = await call(client, "get_deck", { deckId, include: ["facts"] });
    const audit = deckWithFacts.facts;
    expect(audit).not.toHaveProperty("topCuts");
    expect(audit).not.toHaveProperty("score");
    expect(audit).not.toHaveProperty("heuristicScore");
    expect(audit.legality).toBeDefined();
    expect(audit.mana).toBeDefined();
    expect(audit.ownership).toBeDefined();
  });
});

describe("the mana base (design doc 35)", () => {
  it("plans lands to reach the target: Plains for Beza, with reasons", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n30 Plains",
    });
    const res = await call(client, "get_deck", { deckId, include: ["mana_plan"] });
    const plan = res.manaPlan;
    expect(plan.outputKind).toBe("skeleton");
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

describe("deck headings (design doc 34)", () => {
  it("sets a card's heading and writes it in the list, and refuses a card type as a heading", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Beza",
      list: "Commander\n1 Beza, the Bounding Spring\nRemoval (1)\n1 Banishing Light\nDeck\n1 Carrot Cake\n10 Plains",
    });
    await saveChange(client, deckId, { card: "Carrot Cake", quantity: 1, heading: "Food" });
    let deck = await call(client, "get_deck", { view: "full", deckId });
    expect(deck.deck).toMatchObject({ grouping: "custom", headings: ["Removal", "Food"] });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Carrot Cake", heading: "Food" }),
    );
    expect(deck.list).toContain("Removal (1)\n1 Banishing Light");

    const refused = await callTool(context(), "edit_deck", {
      deckId,
      save: true,
      fingerprint: deck.fingerprint,
      changes: [{ card: "Plains", quantity: 10, heading: "Lands" }],
    });
    expect(refused).toMatchObject({
      kind: "outcome",
      outcome: { ok: false, error: { kind: "HeadingInvalid" } },
    });
    deck = await call(client, "get_deck", { view: "full", deckId });
    expect(deck.deck.headings).toEqual(["Removal", "Food"]);
  });
});

describe("plain calls (the HTTP endpoint's core)", () => {
  it("reports an unknown tool, bad input and a missing scope as problems", async () => {
    expect(await callTool(context(), "make_coffee", {})).toMatchObject({
      kind: "problem",
      problem: { kind: "UnknownTool" },
    });
    expect(await callTool(context(), "get_deck", { view: "full", deckId: "seven" })).toMatchObject({
      kind: "problem",
      problem: { kind: "InvalidInput" },
    });
    expect(
      await callTool(context(["read"]), "manage_wishlist", {
        action: "add",
        wishes: [{ card: "Plains" }],
      }),
    ).toMatchObject({
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
  it("sets and reads a line's note", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Notes",
      list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n10 Plains",
    });
    await saveChange(client, deckId, {
      card: "Banishing Light",
      note: "Clean enchantment removal",
    });
    const deck = await call(client, "get_deck", { view: "full", deckId, includeText: false });
    expect(deck.lines).toContainEqual(
      expect.objectContaining({ name: "Banishing Light", note: "Clean enchantment removal" }),
    );
    const compact = await call(client, "get_deck", { deckId, text: false });
    expect(
      Object.values(compact.cards as Record<string, string[]>)
        .flat()
        .join("\n"),
    ).toContain("note: Clean enchantment removal");
  });
});

describe("token and emblem checklist (design doc 42)", () => {
  it("surfaces the token and emblem checklist in get_deck", async () => {
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

    const deck = await call(client, "get_deck", { view: "full", deckId });
    expect(deck.tokens).toMatchObject({
      summary: { total: 2, tokens: 2, emblems: 0, helpers: 0, mainboard: 1, sideboardOnly: 1 },
      items: [
        { name: "Food", kind: "token", madeBy: ["Crumb and Get It"], sideboardOnly: true },
        { name: "Rabbit", kind: "token", madeBy: ["Carrot Cake"], sideboardOnly: false },
      ],
    });

    const compact = await call(client, "get_deck", { deckId, include: ["tokens"] });
    expect(compact.tokens).toEqual(deck.tokens);
    const plain = await call(client, "get_deck", { deckId });
    expect(plain.tokens).toBeUndefined();
  });
});

describe("opening-hand odds & draw_sample", () => {
  it("reports land-drop and turn-3 ramp probabilities in get_deck and deals hand + next draws in draw_sample", async () => {
    const client = await connect();
    const { deckId } = await call(client, "create_deck", {
      name: "Odds Test Deck",
      format: "standard",
      list: ["24 Plains", "4 Carrot Cake", "4 Banishing Light"].join("\n"),
    });

    const deck = await call(client, "get_deck", { view: "full", deckId });
    expect(deck.openingHandOdds).toMatchObject({
      librarySize: 32,
      lands: 24,
      earlyRamp: 0,
    });
    expect(deck.openingHandOdds.threeLandsByTurn3Percent).toBeGreaterThan(90);

    const compact = await call(client, "get_deck", { deckId, include: ["odds"] });
    expect(compact.openingHandOdds).toEqual(deck.openingHandOdds);

    const sample = await call(client, "draw_sample", {
      deckId,
      hands: 2,
      drawNext: 4,
      trials: 200,
      seed: "test-seed",
    });
    expect(sample.samples).toHaveLength(2);
    expect(sample.samples[0].hand).toHaveLength(7);
    expect(sample.samples[0].nextDraws).toHaveLength(4);
    expect(sample.odds.trials).toBe(200);
    expect(sample.odds.turn3LandPct).toBeGreaterThan(90);

    const cast = await call(client, "draw_sample", {
      deckId,
      hands: 1,
      drawNext: 0,
      trials: 200,
      cast: ["Banishing Light"],
      lastTurn: 4,
      seed: "test-seed",
    });
    expect(cast.cast.table).toHaveLength(4);
    expect(cast.cast).toMatchObject({ runs: 200, cards: ["Banishing Light"] });
  });
});

describe("60-card formats (design doc 44)", () => {
  it("exposes formatRules, sideboardCount, 60-card roleTargets and cardLegalIn", async () => {
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

    const deck = await call(client, "get_deck", { view: "full", deckId });
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

    const compact = await call(client, "get_deck", {
      deckId,
      include: ["formatRules", "legality"],
    });
    expect(compact.formatRules).toEqual(deck.formatRules);
    expect(compact.roleTargets).toEqual(deck.roleTargets);
    expect(compact.cardLegalIn).toEqual(["standard", "modern"]);
  });
});

describe("ownership consistency and get_deck include owners", () => {
  it("matches owned counts across get_deck, get_cards, and search_cards including real cards", async () => {
    await give("Banishing Light", 1);
    await db.execute(sql`
      insert into real_cards (user_id, printing_id, finish, quantity, added_at, updated_at)
      select ${jack.userId}, p.id, 'nonfoil', 1, now(), now() from printings p
       where p.name = 'Carrot Cake' order by p.collector_number limit 1
    `);
    const client = await connect();

    const { deckId: deck1 } = await call(client, "create_deck", {
      name: "First",
      format: "casual",
      list: "Deck\n1 Banishing Light\n1 Carrot Cake",
    });
    const { deckId: deck2 } = await call(client, "create_deck", {
      name: "Second",
      format: "casual",
      list: "Deck\n1 Carrot Cake",
    });

    const deck = await call(client, "get_deck", {
      view: "full",
      deckId: deck1,
    });
    const carrotLine = deck.lines.find((line: { name: string }) => line.name === "Carrot Cake");
    expect(carrotLine.owned).toBe(1);
    expect(carrotLine.ownedReal).toBe(1);
    expect(carrotLine.free).toBe(0);
    expect(carrotLine.otherDecks).toBeUndefined();

    const deckWithOthers = await call(client, "get_deck", {
      view: "full",
      deckId: deck2,
      include: ["owners"],
    });
    const carrotWithOthers = deckWithOthers.lines.find(
      (line: { name: string }) => line.name === "Carrot Cake",
    );
    expect(carrotWithOthers.otherDecks).toHaveLength(1);

    const cardsRes = await call(client, "get_cards", { cards: ["Carrot Cake"] });
    expect(cardsRes.cards[0]).toMatchObject({ ownedGame: 0, ownedReal: 1 });

    const ownedSearch = await call(client, "search_cards", {
      search: "Carrot Cake",
      where: "owned",
    });
    expect(ownedSearch.totals.copies).toBe(1);
    expect(ownedSearch.cards[0]).toMatchObject({
      name: "Carrot Cake",
      source: "real",
      quantity: 1,
    });

    const gameOnly = await call(client, "search_cards", {
      search: "Carrot Cake",
      where: "game",
    });
    expect(gameOnly.totals.copies).toBe(0);

    const realOnly = await call(client, "search_cards", {
      search: "Carrot Cake",
      where: "real",
    });
    expect(realOnly.totals.copies).toBe(1);
  });
});
