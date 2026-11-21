import { describe, expect, it } from "vitest";
import type { EdhrecCommanderData, SpellbookCombosResult } from "@/modules/catalog";
import { UserId } from "@/shared/kernel";
import { fixedClock } from "@/shared/kernel/testing";
import type { DeckPlan, DeckView } from "@/modules/decks/core/client";
import { makeDeckCombos, makeEdhrecResearch } from "@/modules/decks/core";
import { makeDrawSample } from "@/modules/decks/play";

const userId = UserId.of("1");

function line(name: string, board: string, extra: object = {}) {
  return {
    oracleId: `o-${name}`,
    name,
    board,
    quantity: 1,
    manaCost: "{1}",
    manaValue: 1,
    typeLine: board === "commander" ? "Legendary Creature" : "Artifact",
    text: "",
    isBasicLand: false,
    ...extra,
  };
}

const view = (lines: object[]) =>
  ({ deck: { id: 5, format: "commander" }, lines }) as unknown as DeckView;

const page: EdhrecCommanderData = {
  commander: "Boss",
  slug: "boss",
  sourceUrl: "https://edhrec.example/boss",
  fetchedAt: "2026-01-01T00:00:00Z",
  cached: false,
  deckCount: 1000,
  themes: [],
  averageDecklist: null,
  cards: [
    { name: "Sol Ring", inclusionPct: 90, synergy: 1, category: "Mana Artifacts" },
    { name: "Mind Stone", inclusionPct: 60, synergy: 2, category: "Mana Artifacts" },
    { name: "Dark Ritual", inclusionPct: 50, synergy: 3, category: "Instants" },
    { name: "Rare Thing", inclusionPct: 5, synergy: 0, category: "Other" },
  ],
};

const noOwned = async () => [];

describe("edhrec compareDeck", () => {
  const deck = view([
    line("Boss", "commander"),
    line("Sol Ring", "main"),
    line("Homebrew", "main"),
    line("Forest", "main", { isBasicLand: true, typeLine: "Basic Land — Forest" }),
  ]);
  const base = {
    fetchCommander: async () => page,
    deckView: async () => deck,
    profile: async () => null as DeckPlan | null,
    ownedChecks: noOwned,
  };

  it("sorts what the deck shares, what it lacks and what EDHREC doesn't list", async () => {
    const result = await makeEdhrecResearch(base).compareDeck({ userId, deckId: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inDeckWithEdhrec.map((card) => card.name)).toEqual(["Sol Ring"]);
    expect(result.value.inDeckNotOnEdhrec.map((card) => card.name)).toEqual(["Homebrew"]);
    // Rare Thing is under 20%, so only the popular missing cards are listed, by name.
    expect(result.value.highInclusionNotInDeck.map((card) => card.name)).toEqual([
      "Dark Ritual",
      "Mind Stone",
    ]);
  });

  it("leaves out cards the profile avoids, and says so", async () => {
    const avoid = { avoid: [{ cardName: "Mind Stone", reason: "no" }] } as unknown as DeckPlan;
    const result = await makeEdhrecResearch({ ...base, profile: async () => avoid }).compareDeck({
      userId,
      deckId: 5,
    });
    expect(result.ok && result.value.leftOutAvoid).toEqual(["Mind Stone"]);
    expect(result.ok && result.value.highInclusionNotInDeck.map((c) => c.name)).toEqual([
      "Dark Ritual",
    ]);
  });

  it("needs a commander, and reports an unreachable EDHREC", async () => {
    const noCommander = makeEdhrecResearch({ ...base, deckView: async () => view([]) });
    expect(await noCommander.compareDeck({ userId, deckId: 5 })).toEqual({
      ok: false,
      error: { kind: "CommanderMissing" },
    });
    const down = makeEdhrecResearch({
      ...base,
      fetchCommander: async () => {
        throw new Error("timeout");
      },
    });
    expect(await down.compareDeck({ userId, deckId: 5 })).toEqual({
      ok: false,
      error: { kind: "EdhrecUnavailable", reason: "timeout" },
    });
  });
});

describe("deck combos", () => {
  const combo = (id: string, uses: string[]) => ({
    id,
    uses,
    produces: ["Win"],
    steps: "",
    prerequisites: "",
    bracketTag: "O",
    manaNeeded: null,
    identity: "B",
  });
  const spellbook: SpellbookCombosResult = {
    sourceUrl: "u",
    fetchedAt: "t",
    cached: true,
    complete: [combo("a", ["Sol Ring", "Maybe Card"]), combo("b", ["Sol Ring", "Boss"])],
    oneCardAway: [{ ...combo("c", ["Sol Ring"]), missingCardName: "Needed" }],
  };
  const deck = view([
    line("Boss", "commander"),
    line("Sol Ring", "main"),
    line("Maybe Card", "maybe"),
  ]);
  const combos = makeDeckCombos({
    fetchCombos: async () => spellbook,
    deckView: async () => deck,
    profile: async () => null,
    ownedChecks: async () => [
      {
        query: "Needed",
        inCatalog: true,
        name: "Needed",
        oracleId: "x",
        ownedGame: 1,
        ownedReal: 0,
        ownedTotal: 1,
        cheapestPriceCents: 25,
        decks: [],
      },
    ],
  });

  it("tells complete combos from ones that need a maybeboard card", async () => {
    const result = await combos.combosForDeck({
      userId,
      deckId: 5,
      includeMaybe: true,
      limit: 20,
      offset: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.complete.map((c) => [c.id, c.status])).toEqual([
      ["a", "needsMaybe"],
      ["b", "complete"],
    ]);
    expect(result.value.totalComplete).toBe(1);
    expect(result.value.totalNeedsMaybe).toBe(1);
  });

  it("names the missing piece of a combo one card away, and whether it is owned", async () => {
    const result = await combos.combosForDeck({
      userId,
      deckId: 5,
      includeMaybe: false,
      limit: 20,
      offset: 0,
    });
    expect(result.ok && result.value.oneAway[0]?.missingPiece).toEqual({
      name: "Needed",
      inCatalog: true,
      owned: true,
      ownedTotal: 1,
      cheapestPriceCents: 25,
    });
  });

  it("filters by bracket letter", async () => {
    const result = await combos.combosForDeck({
      userId,
      deckId: 5,
      includeMaybe: false,
      bracket: "P",
      limit: 20,
      offset: 0,
    });
    expect(result.ok && result.value.complete).toEqual([]);
  });
});

describe("draw sample", () => {
  const lines = [
    line("Boss", "commander"),
    ...Array.from({ length: 40 }, (_, i) =>
      line(`Card ${i}`, "main", {
        oracleId: `c${i}`,
        typeLine: i < 16 ? "Basic Land" : "Artifact",
      }),
    ),
  ];
  const sampler = (deck: DeckView | null) =>
    makeDrawSample({
      deckView: async () => deck,
      profile: async () => null,
      clock: fixedClock("2026-01-01T00:00:00Z"),
    });
  const request = { userId, deckId: 5, hands: 2, drawNext: 3, trials: 100, seed: "s" };

  it("deals the hands asked for, the same each time for one seed", async () => {
    const first = await sampler(view(lines)).drawSample(request);
    const second = await sampler(view(lines)).drawSample(request);
    expect(first.ok && first.value.samples).toHaveLength(2);
    expect(first.ok && first.value.samples[0]?.hand).toHaveLength(7);
    expect(first.ok && first.value.samples[0]?.nextDraws).toHaveLength(3);
    expect(first).toEqual(second);
  });

  it("refuses a deck with fewer than seven cards, and a missing one", async () => {
    expect(await sampler(view(lines.slice(0, 4))).drawSample(request)).toEqual({
      ok: false,
      error: { kind: "DeckTooSmall", minimum: 7 },
    });
    expect(await sampler(null).drawSample(request)).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
  });
});
