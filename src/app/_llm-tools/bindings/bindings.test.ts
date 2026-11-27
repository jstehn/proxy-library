import { describe, expect, it } from "vitest";
import { err, ok, UserId } from "@/shared/kernel";
import type { Actor } from "@/modules/accounts";
import type { ToolContext } from "../tool";
import { getAccountBinding } from "./get-account";
import { listDecksBinding } from "./list-decks";
import { BINDINGS } from "./index";
import { callTool } from "../registry";

// The two example bindings, run against fake capabilities: no database, no container.

const actor = {
  userId: UserId.of("1"),
  username: "jack",
  displayName: "Jack",
  isAdmin: false,
  canSelfFund: false,
  mustChangePassword: false,
} as Actor;

function contextWith(capabilities: object): ToolContext {
  return {
    actor,
    scopes: ["read"],
    allows: () => true,
    capabilities: capabilities as unknown as ToolContext["capabilities"],
    reads: {} as ToolContext["reads"],
  };
}

describe("list_decks binding", () => {
  it("presents the decks the capability returns", async () => {
    const context = contextWith({
      listDecks: async () =>
        ok([
          {
            id: 4,
            name: "Elves",
            format: "commander",
            cards: 99,
            short: 2,
            usesRealCards: false,
            visibility: "private",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
    });
    const result = await callTool(context, "list_decks", {});
    expect(result).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: {
          decks: [
            {
              id: 4,
              name: "Elves",
              format: "commander",
              cards: 99,
              short: 2,
              usesRealCards: false,
              visibility: "private",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    });
  });
});

describe("get_account binding", () => {
  it("presents balance, allowance and totals in cents", async () => {
    const next = new Date("2026-02-01T00:00:00Z");
    const context = contextWith({
      getAccountOverview: async () =>
        ok({
          balanceCents: 5000,
          allowance: { amountCents: 1000, everyDays: 7, next },
          collection: { differentCards: 1, copies: 2, valueCents: 12 },
          decks: 3,
          wishes: 0,
        }),
    });
    const result = await callTool(context, "get_account", {});
    expect(result).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: {
          player: { username: "jack", displayName: "Jack" },
          scopes: ["read"],
          balance: 5000,
          allowance: { amount: 1000, everyDays: 7, next: next.toISOString() },
          collection: { differentCards: 1, copies: 2, value: 12 },
          decks: 3,
          wishes: 0,
        },
      },
    });
  });

  it("refuses a token without the scope", async () => {
    const context = { ...contextWith({}), allows: () => false };
    expect(await callTool(context, "get_account", {})).toMatchObject({
      kind: "problem",
      problem: { kind: "MissingScope" },
    });
  });
});

describe("the bindings list", () => {
  it("has unique names and a flat input each", () => {
    expect(BINDINGS.map((binding) => binding.name)).toEqual([
      "create_deck",
      "draw_sample",
      "edhrec_lookup",
      "edit_deck",
      "find_combos",
      "find_replacements",
      "get_account",
      "get_cards",
      "get_deck",
      "list_decks",
      "manage_wishlist",
      "reddit_research",
      "rules_lookup",
      "search_cards",
      "update_deck",
      "youtube_research",
    ]);
    expect(getAccountBinding.input.shape).toEqual({});
    expect(listDecksBinding.input.shape).toEqual({});
  });
});

describe("edit_deck binding", () => {
  const writer = (capabilities: object): ToolContext => ({
    ...contextWith(capabilities),
    scopes: ["read", "decks:write"],
  });
  const outcomeOf = async (context: ToolContext, input: unknown) => {
    const result = await callTool(context, "edit_deck", input);
    if (result.kind !== "outcome") throw new Error("expected an outcome");
    return result.outcome;
  };

  it("replaces the list and reports the card count", async () => {
    const replaceList = async () => ok({ cards: 99 });
    const outcome = await outcomeOf(writer({ deckEdits: { replaceList } }), {
      deckId: 3,
      list: "1 Sol Ring",
      fingerprint: "fp",
    });
    expect(outcome).toEqual({ ok: true, value: { deckId: 3, cards: 99 } });
  });

  it("needs the fingerprint to replace a list", async () => {
    const outcome = await outcomeOf(writer({}), { deckId: 3, list: "1 Sol Ring" });
    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: "InvalidInput",
        message: "Provide `fingerprint` from get_deck when replacing `list`.",
      },
    });
  });

  it("applies a stored preview by id when saving without changes", async () => {
    const asked: unknown[] = [];
    const applyPreview = async (_actor: unknown, input: unknown) => {
      asked.push(input);
      return err({ kind: "PreviewExpired" });
    };
    const outcome = await outcomeOf(writer({ deckPreviews: { applyPreview } }), {
      deckId: 3,
      save: true,
      previewId: "p1",
    });
    expect(asked).toEqual([{ deckId: 3, previewId: "p1", fingerprint: undefined }]);
    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: "PreviewExpired",
        message: "That previewId is missing or expired. Preview the changes again.",
      },
    });
  });

  it("asks for changes when there are none", async () => {
    const outcome = await outcomeOf(writer({}), { deckId: 3 });
    expect(outcome).toMatchObject({ ok: false, error: { kind: "InvalidInput" } });
  });

  it("says which cards the catalog lacks", async () => {
    const previewChanges = async () => err({ kind: "CardsNotFound", names: ["Nope"] });
    const outcome = await outcomeOf(writer({ deckPreviews: { previewChanges } }), {
      deckId: 3,
      changes: [{ card: "Nope", quantity: 1 }],
    });
    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: "CardNotFound",
        message: "Cards not in the catalog (nothing previewed or saved): Nope.",
      },
    });
  });
});

describe("create_deck binding", () => {
  it("returns the deck id, and what the list added", async () => {
    const startDeck = async () =>
      ok({ deckId: 8, added: 2, unreadable: ["???"], notFound: ["Nope"], listError: null });
    const context = {
      ...contextWith({ startDeck: { startDeck } }),
      scopes: ["read", "decks:write"] as const,
    } as ToolContext;
    expect(
      await callTool(context, "create_deck", { name: "Elves", list: "2 Elvish Mystic" }),
    ).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: { deckId: 8, added: 2, unreadable: ["???"], notFound: ["Nope"] },
      },
    });
  });
});

describe("update_deck binding", () => {
  const writer = (capabilities: object): ToolContext =>
    ({
      ...contextWith(capabilities),
      scopes: ["read", "decks:write"],
    }) as ToolContext;

  it("won't delete without confirm", async () => {
    const result = await callTool(writer({}), "update_deck", { deckId: 1, deleteDeck: true });
    expect(result).toMatchObject({
      kind: "outcome",
      outcome: { ok: false, error: { kind: "ConfirmationRequired" } },
    });
  });

  it("reports each kind of change it made", async () => {
    const context = writer({
      deckEdits: { updateDeck: async () => ok(undefined) },
      deckPlanEdits: {
        setProfile: async () => ok({}),
        setPrimer: async () => ok({ deckId: 1, primer: "x" }),
      },
    });
    const result = await callTool(context, "update_deck", {
      deckId: 1,
      name: "New",
      plan: "Go wide",
      primerContent: "x",
    });
    expect(result).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: { deckId: 1, metadataUpdated: true, profileUpdated: true, primerUpdated: true },
      },
    });
  });

  it("needs at least one field", async () => {
    const result = await callTool(writer({}), "update_deck", { deckId: 1 });
    expect(result).toMatchObject({
      kind: "outcome",
      outcome: { ok: false, error: { kind: "InvalidInput" } },
    });
  });
});

describe("research bindings", () => {
  const outcome = async (capabilities: object, name: string, input: unknown) => {
    const result = await callTool(contextWith(capabilities), name, input);
    if (result.kind !== "outcome") throw new Error("expected an outcome");
    return result.outcome;
  };

  it("rules_lookup searches the rules by query and says when none are synced", async () => {
    const searchRules = async () => ok({ crVersion: null, hits: [] });
    const result = await outcome({ rulesLookup: { searchRules } }, "rules_lookup", { query: "x" });
    expect(result).toMatchObject({ ok: true, value: { crVersion: null, hits: [] } });
  });

  it("rules_lookup wraps one card's rulings in `cards`, and names a missing card", async () => {
    const found = { query: "A", found: true, rulings: [] };
    const hit = await outcome(
      { rulesLookup: { rulingsForCard: async () => ok(found) } },
      "rules_lookup",
      { cards: ["A"] },
    );
    expect(hit).toEqual({ ok: true, value: { cards: [found] } });
    const miss = await outcome(
      { rulesLookup: { rulingsForCard: async () => err({ kind: "CardNotFound", query: "A" }) } },
      "rules_lookup",
      { cards: ["A"] },
    );
    expect(miss).toEqual({
      ok: false,
      error: { kind: "CardNotFound", message: 'No card named "A" in catalog.' },
    });
  });

  it("edhrec_lookup cuts the commander's cards to `limit`", async () => {
    const data = {
      commander: "Boss",
      sourceUrl: "u",
      fetchedAt: "t",
      cached: true,
      deckCount: 1200,
      themes: [],
      averageDecklist: null,
      cards: [1, 2, 3].map((n) => ({ name: `C${n}`, inclusionPct: n, synergy: 0, category: "x" })),
    };
    const result = await outcome(
      { edhrec: { forCommander: async () => ok(data) } },
      "edhrec_lookup",
      { commander: "Boss", limit: 2 },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { totalCards: 3, cards: [{ name: "C1" }, { name: "C2" }], deckCount: 1200 },
    });
  });

  it("edhrec_lookup says what to pass when given neither commander nor deck", async () => {
    expect(await outcome({}, "edhrec_lookup", {})).toEqual({
      ok: false,
      error: { kind: "InvalidInput", message: "Provide `commander` or `deckId`." },
    });
  });

  it("youtube_research and reddit_research say what to pass when given nothing", async () => {
    expect(await outcome({}, "youtube_research", {})).toMatchObject({
      ok: false,
      error: { kind: "InvalidInput" },
    });
    expect(await outcome({}, "reddit_research", {})).toMatchObject({
      ok: false,
      error: { kind: "InvalidInput" },
    });
  });

  it("youtube_research passes the service's answer and its failures through", async () => {
    const searchDeckTechs = async () => err({ kind: "RateLimited", message: "slow down" });
    expect(
      await outcome({ youtube: { searchDeckTechs } }, "youtube_research", { query: "x" }),
    ).toEqual({ ok: false, error: { kind: "RateLimited", message: "slow down" } });
  });
});

describe("token efficiency & bug fix bindings", () => {
  it("manage_wishlist formats shortBy paydays count without [object Object]", async () => {
    const context = contextWith({
      wishlistView: async () =>
        ok({
          balance: 100,
          totalForMissing: 300,
          lines: [
            {
              wish: { id: 1, quantity: 1, targetPrice: null, note: "" },
              name: "Doubling Season",
              owned: 0,
              missing: 1,
              offer: { price: 161 },
              total: 161,
              atTarget: false,
              status: {
                kind: "shortBy",
                shortfall: 61,
                paydays: { count: 1, date: new Date("2026-11-30T00:00:00Z") },
              },
            },
            {
              wish: { id: 2, quantity: 1, targetPrice: null, note: "" },
              name: "Sol Ring",
              owned: 0,
              missing: 1,
              offer: { price: 150 },
              total: 150,
              atTarget: false,
              status: { kind: "shortBy", shortfall: 50, paydays: null },
            },
          ],
        }),
    });
    const result = await callTool(context, "manage_wishlist", { action: "list" });
    expect(result).toMatchObject({
      kind: "outcome",
      outcome: {
        ok: true,
        value: {
          wishes: [
            { name: "Doubling Season", status: "shortBy:61c/1p" },
            { name: "Sol Ring", status: "shortBy:50c" },
          ],
        },
      },
    });
  });

  it("edit_deck returns a minimal ack when committing via previewId", async () => {
    const context = contextWith({
      deckPreviews: {
        applyPreview: async () =>
          ok({
            fingerprint: "fp-next",
            warnings: [],
            preview: {
              deck: { id: 60, name: "Kudo", format: "commander" },
              after: { stats: { cardCount: 100 }, shortTotal: 2 },
            },
          }),
      },
    });
    const result = await callTool(context, "edit_deck", {
      deckId: 60,
      previewId: "p-1",
      save: true,
    });
    expect(result).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: {
          saved: true,
          deckId: 60,
          fingerprint: "fp-next",
          cardCount: 100,
          shortTotal: 2,
        },
      },
    });
  });

  it("get_cards includes deduplicated sets on detail='compact' only when includeSets is true", async () => {
    const asked: unknown[] = [];
    const context = contextWith({
      lookUpCards: async (_actor: Actor, request: unknown) => {
        asked.push(request);
        return ok([
          {
            query: "Doubling Season",
            found: true,
            card: {
              name: "Doubling Season",
              oracleId: "o1",
              printingId: "p1",
              typeLine: "Enchantment",
              manaCost: "{4}{G}",
              colorIdentity: ["G"],
            },
            faces: [{ text: "If an effect would create one or more tokens..." }],
            set: { code: "FDN", name: "Foundations" },
            priceTrend: [],
            owned: { total: 0, game: 0, real: 0, printings: [] },
            ownedOfThisPrinting: {},
            decksUsing: [],
            wishes: [],
            printingsForSale: [],
            sets: ["CMM", "FDN", "RAV"],
          },
        ]);
      },
    });
    const withSets = await callTool(context, "get_cards", {
      cards: ["Doubling Season"],
      detail: "compact",
      includeSets: true,
    });
    expect(asked[0]).toEqual({
      queries: ["Doubling Season"],
      includeSets: true,
      includeHistory: false,
      includeStorePrintings: false,
      includeOwnedOfPrinting: false,
    });
    expect(withSets).toMatchObject({
      kind: "outcome",
      outcome: {
        ok: true,
        value: { cards: [{ name: "Doubling Season", sets: ["CMM", "FDN", "RAV"] }] },
      },
    });

    const withoutSets = await callTool(context, "get_cards", {
      cards: ["Doubling Season"],
      detail: "compact",
    });
    expect(withoutSets.kind === "outcome" && withoutSets.outcome.ok).toBe(true);
    if (withoutSets.kind === "outcome" && withoutSets.outcome.ok) {
      const value = withoutSets.outcome.value as { cards: Record<string, unknown>[] };
      expect(value.cards[0]?.sets).toBeUndefined();
    }
  });

  it("search_cards parses addedSince shorthand, forwards sort, and shows prices for price_desc", async () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const calls: unknown[] = [];
    const context = contextWith({
      now: () => now,
      searchCatalog: async (_actor: Actor, request: unknown) => {
        calls.push(request);
        return ok({
          kind: "owned",
          notes: [],
          totals: { cards: 1, copies: 1 },
          pageCount: 1,
          cards: [
            {
              name: "Doubling Season",
              printingId: "p1",
              set: "FDN",
              finish: "nonfoil",
              quantity: 1,
              source: "game",
              text: "Tokens",
              price: 3500,
            },
          ],
        });
      },
    });
    const result = await callTool(context, "search_cards", {
      where: "owned",
      addedSince: "24h",
      sort: "price_desc",
    });
    expect(calls[0]).toEqual({
      search: "",
      where: "owned",
      page: 1,
      pageSize: 10,
      oneRowPerCard: true,
      sort: "price_desc",
      addedSince: new Date("2026-11-23T12:00:00Z"),
    });
    expect(result).toMatchObject({
      kind: "outcome",
      outcome: {
        ok: true,
        value: { cards: [{ name: "Doubling Season", priceCents: 3500 }] },
      },
    });

    const badDate = await callTool(context, "search_cards", { addedSince: "yesterday" });
    expect(badDate).toMatchObject({
      kind: "outcome",
      outcome: { ok: false, error: { kind: "InvalidInput" } },
    });

    const onStore = await callTool(context, "search_cards", {
      where: "store",
      addedSince: "7d",
    });
    expect(onStore).toMatchObject({
      kind: "outcome",
      outcome: { ok: false, error: { kind: "InvalidInput" } },
    });
  });
});
