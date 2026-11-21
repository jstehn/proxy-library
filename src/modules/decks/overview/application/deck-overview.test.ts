import { describe, expect, it } from "vitest";
import { testActor } from "@/modules/accounts/testing/actors";
import { aDeckView, aLine } from "../../testing/deck-view";
import { makeDeckOverview, type DeckOverviewReaders } from "./deck-overview";

function readers(
  view: ReturnType<typeof aDeckView> | null,
  asked: string[] = [],
): DeckOverviewReaders {
  return {
    deckView: async () => view,
    viewableDeckView: async () => view,
    combosFor: async () => {
      asked.push("combos");
      return undefined;
    },
    printingCards: async () => {
      asked.push("printings");
      return new Map();
    },
    tokenLines: async () => {
      asked.push("tokens");
      return [];
    },
    sources: async () => {
      asked.push("sources");
      return [];
    },
    profile: async () => {
      asked.push("profile");
      return null;
    },
  };
}

const actor = testActor();

describe("deckOverview", () => {
  it("says the deck isn't the player's when no deck comes back", async () => {
    const overview = makeDeckOverview(readers(null));
    const result = await overview(actor, { deckId: 9 });
    expect(result).toEqual({ ok: false, error: { kind: "DeckNotFound" } });
  });

  it("works out the stats, problems and list once", async () => {
    const view = aDeckView([aLine("Elf", { quantity: 2, owned: 1 })]);
    const result = await makeDeckOverview(readers(view))(actor, { deckId: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stats.cardCount).toBe(2);
    expect(result.value.problems).toContainEqual(expect.objectContaining({ kind: "Short" }));
    expect(result.value.list).toContain("2 Elf");
    expect(result.value.fingerprint).not.toBe("");
    expect(result.value.bracket).toBeNull();
  });

  it("reads only the parts it's asked for", async () => {
    const asked: string[] = [];
    const view = aDeckView([aLine("Elf")]);
    await makeDeckOverview(readers(view, asked))(actor, { deckId: 1 });
    expect(asked).toEqual([]);
    await makeDeckOverview(readers(view, asked))(actor, {
      deckId: 1,
      parts: { printings: true, tokens: true, sources: true, profile: true },
    });
    expect(asked.sort()).toEqual(["printings", "profile", "sources", "tokens"]);
  });

  it("looks for combos and estimates the bracket in Commander only", async () => {
    const asked: string[] = [];
    const view = aDeckView([aLine("Elf")], { format: "commander" });
    const result = await makeDeckOverview(readers(view, asked))(actor, { deckId: 1 });
    expect(asked).toEqual(["combos"]);
    expect(result.ok && result.value.bracket).not.toBeNull();
  });

  it("gives opening-hand odds only on request", async () => {
    const view = aDeckView([aLine("Elf", { quantity: 40 })]);
    const without = await makeDeckOverview(readers(view))(actor, { deckId: 1 });
    expect(without.ok && "odds" in without.value).toBe(false);
    const withOdds = await makeDeckOverview(readers(view))(actor, {
      deckId: 1,
      parts: { odds: true },
    });
    expect(withOdds.ok && withOdds.value.odds?.librarySize).toBe(40);
  });
});
