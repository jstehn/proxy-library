import { describe, expect, it, vi } from "vitest";
import type { Fetch } from "@/shared/http";
import { CACHE_TTL_MS, makeOutsideData, TtlCache } from "./outside-data";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TEST_CLOCK = { now: () => new Date("2026-11-17T20:00:00Z") };

describe("TtlCache", () => {
  it("caches values until TTL expires", async () => {
    let nowMs = 1_000_000;
    const cache = new TtlCache<number>(CACHE_TTL_MS, { now: () => new Date(nowMs) });
    const fetcher = vi.fn(async () => 42);

    const first = await cache.getOrFetch("k", fetcher);
    expect(first.cached).toBe(false);
    expect(first.value).toBe(42);

    nowMs += 60_000;
    const second = await cache.getOrFetch("k", fetcher);
    expect(second.cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    nowMs += CACHE_TTL_MS;
    const third = await cache.getOrFetch("k", fetcher);
    expect(third.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts least recently used entries past maxEntries and cleans expired ones", async () => {
    const nowMs = 1_000_000;
    const cache = new TtlCache<string>(10_000, { now: () => new Date(nowMs) }, 2);
    const fetcher = vi.fn(async (label: string) => label);

    await cache.getOrFetch("a", () => fetcher("a"));
    await cache.getOrFetch("b", () => fetcher("b"));
    // Refresh "a" so "b" is LRU.
    const hitA = await cache.getOrFetch("a", () => fetcher("a2"));
    expect(hitA.cached).toBe(true);
    expect(hitA.value).toBe("a");

    await cache.getOrFetch("c", () => fetcher("c"));
    expect(fetcher).toHaveBeenCalledTimes(3);

    // "a" survived, "b" was evicted.
    expect((await cache.getOrFetch("a", () => fetcher("a3"))).cached).toBe(true);
    expect((await cache.getOrFetch("b", () => fetcher("b2"))).cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("deduplicates concurrent in-flight fetches and does not cache failures", async () => {
    const nowMs = 1_000_000;
    const cache = new TtlCache<number>(CACHE_TTL_MS, { now: () => new Date(nowMs) });
    let resolvePending!: (value: number) => void;
    const slowFetcher = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolvePending = resolve;
        }),
    );

    const p1 = cache.getOrFetch("shared", slowFetcher);
    const p2 = cache.getOrFetch("shared", slowFetcher);
    expect(slowFetcher).toHaveBeenCalledTimes(1);

    resolvePending(99);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.value).toBe(99);
    expect(r2.value).toBe(99);

    // Subsequent call hits cache.
    const r3 = await cache.getOrFetch("shared", slowFetcher);
    expect(r3.cached).toBe(true);
    expect(slowFetcher).toHaveBeenCalledTimes(1);

    // Errors reject all waiters, clean up inFlight, and are never cached.
    let rejectPending!: (error: Error) => void;
    const failingFetcher = vi.fn(
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    const f1 = cache.getOrFetch("err", failingFetcher);
    const f2 = cache.getOrFetch("err", failingFetcher);
    expect(failingFetcher).toHaveBeenCalledTimes(1);
    rejectPending(new Error("boom"));
    await expect(f1).rejects.toThrow("boom");
    await expect(f2).rejects.toThrow("boom");

    const retry = await cache.getOrFetch("err", async () => 7);
    expect(retry.cached).toBe(false);
    expect(retry.value).toBe(7);
  });
});

describe("makeOutsideData", () => {
  it("fetches and caches Scryfall rulings by scryfallId, and handles 404", async () => {
    const fetchFn = vi.fn<Fetch>(async (url) => {
      if (url.includes("missing")) return jsonResponse({}, 404);
      return jsonResponse({
        data: [
          {
            published_at: "2022-04-29",
            source: "wotc",
            comment: "Blitz is an alternative cost.",
          },
        ],
      });
    });
    const outside = makeOutsideData(TEST_CLOCK, fetchFn);

    const first = await outside.fetchScryfallRulings({ name: "Henzie", scryfallId: "abc-123" });
    expect(first).toMatchObject({
      name: "Henzie",
      cached: false,
      rulings: [
        {
          publishedAt: "2022-04-29",
          source: "wotc",
          comment: "Blitz is an alternative cost.",
        },
      ],
    });

    const second = await outside.fetchScryfallRulings({ name: "Henzie", scryfallId: "abc-123" });
    expect(second?.cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const missing = await outside.fetchScryfallRulings({ name: "Nope", scryfallId: "missing" });
    expect(missing).toBeNull();
  });

  it("parses EDHREC deck count, themes, cards, and average decklist", async () => {
    const fetchFn = vi.fn<Fetch>(async () =>
      jsonResponse({
        container: {
          json_dict: {
            card: { name: 'Henzie "Toolbox" Torre', num_decks: 18994 },
            panels: {
              taglinks: [{ value: "Reanimator", slug: "reanimator", count: 1200 }],
            },
            cardlists: [
              {
                header: "High Synergy Cards",
                cardviews: [
                  {
                    name: "Ojer Kaslem, Deepest Growth",
                    num_decks: 11016,
                    potential_decks: 18994,
                    synergy: 0.41,
                  },
                ],
              },
            ],
            avg_deck: "1 Sol Ring\n1 Sakura-Tribe Elder",
          },
        },
      }),
    );
    const outside = makeOutsideData(TEST_CLOCK, fetchFn);

    const data = await outside.fetchEdhrecCommander('Henzie "Toolbox" Torre', {
      theme: "reanimator",
      budget: "budget",
    });
    expect(data).not.toBeNull();
    expect(data?.deckCount).toBe(18994);
    expect(data?.sourceUrl).toBe(
      "https://json.edhrec.com/pages/commanders/henzie-toolbox-torre/reanimator/budget.json",
    );
    expect(data?.themes).toEqual([{ name: "Reanimator", slug: "reanimator", count: 1200 }]);
    expect(data?.cards).toEqual([
      {
        name: "Ojer Kaslem, Deepest Growth",
        inclusionPct: 58,
        synergy: 0.41,
        category: "High Synergy Cards",
      },
    ]);
    expect(data?.averageDecklist).toEqual(["1 Sol Ring", "1 Sakura-Tribe Elder"]);
  });

  it("parses Spellbook complete and 1-card-away N-card combos", async () => {
    const fetchFn = vi.fn<Fetch>(async () =>
      jsonResponse({
        results: {
          included: [
            {
              id: "101",
              uses: [
                { card: { name: 'Henzie "Toolbox" Torre' } },
                { card: { name: "Ancestral Statue" } },
                { card: { name: "Elemental Bond" } },
              ],
              produces: [{ feature: { name: "Infinite card draw" } }],
              description: "Cast Ancestral Statue with blitz.",
              easyPrerequisites: "Henzie cast 4 times.",
              bracketTag: "3",
              manaNeeded: "{0}",
              identity: "BRG",
            },
          ],
          almostIncluded: [
            {
              id: "202",
              uses: [
                { card: { name: "Mikaeus, the Unhallowed" } },
                { card: { name: "Triskelion" } },
              ],
              produces: [{ feature: { name: "Infinite damage" } }],
              description: "Ping with Triskelion.",
              easyPrerequisites: "",
              bracketTag: "4",
              manaNeeded: "{6}",
              identity: "B",
            },
            {
              id: "303",
              uses: [
                { card: { name: "Card A" } },
                { card: { name: "Card B" } },
                { card: { name: "Card C" } },
              ],
              produces: [{ feature: { name: "Something" } }],
              description: "",
              easyPrerequisites: "",
              bracketTag: null,
              manaNeeded: null,
              identity: "G",
            },
            {
              id: "404",
              uses: [
                { card: { name: "Cathars' Crusade" } },
                { card: { name: "Goblin Bombardment" } },
              ],
              requires: [
                {
                  quantity: 1,
                  template: {
                    name: "A creature that creates a token when it dies",
                    scryfallQuery: 't:creature o:"when" o:"dies" o:"create"',
                  },
                },
              ],
              produces: [{ feature: { name: "Infinite damage" } }],
              description: "Sacrifice token-maker.",
              easyPrerequisites: "",
              bracketTag: "3",
              manaNeeded: "{0}",
              identity: "RW",
            },
          ],
        },
      }),
    );
    const outside = makeOutsideData(TEST_CLOCK, fetchFn);

    const res = await outside.fetchSpellbookCombos(
      [
        "Ancestral Statue",
        "Elemental Bond",
        "Mikaeus, the Unhallowed",
        "Cathars' Crusade",
        "Goblin Bombardment",
      ],
      ['Henzie "Toolbox" Torre'],
    );

    expect(res.complete).toHaveLength(1);
    expect(res.complete[0]).toMatchObject({
      id: "101",
      uses: ['Henzie "Toolbox" Torre', "Ancestral Statue", "Elemental Bond"],
      produces: ["Infinite card draw"],
      prerequisites: "Henzie cast 4 times.",
      bracketTag: "3",
    });

    expect(res.oneCardAway).toHaveLength(1);
    expect(res.oneCardAway[0]).toMatchObject({
      id: "202",
      missingCardName: "Triskelion",
      bracketTag: "4",
    });

    expect(res.needsTemplate).toHaveLength(1);
    expect(res.needsTemplate?.[0]).toMatchObject({
      id: "404",
      uses: ["Cathars' Crusade", "Goblin Bombardment"],
      requires: [
        {
          name: "A creature that creates a token when it dies",
          quantity: 1,
          scryfallQuery: 't:creature o:"when" o:"dies" o:"create"',
        },
      ],
    });
  });
});
