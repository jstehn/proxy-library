import { describe, expect, it } from "vitest";
import {
  hitLevel,
  initialState,
  openingReducer,
  packValueCents,
  revealedCount,
  type OpenerCard,
  type OpenerPack,
  type OpeningEvent,
  type OpeningState,
} from "./machine";

function card(name: string, rarity = "common", priceCents: number | null = 10): OpenerCard {
  return {
    printingId: name,
    name,
    rarity,
    finish: "nonfoil",
    priceCents,
    hasImage: true,
    variantLabel: "",
  };
}

function pack(itemId: number, cards: OpenerCard[]): OpenerPack {
  return {
    itemId,
    name: `Pack ${itemId}`,
    setCode: "TST",
    setName: "Test",
    keyruneCode: "tst",
    label: "Play Booster Pack",
    featuredPrintingId: null,
    photoIds: [],
    photoVariant: 0,
    cards,
  };
}

const packs = [pack(1, [card("a"), card("b"), card("r", "rare")]), pack(2, [card("c")])];

function run(events: OpeningEvent["type"][], start: OpeningState = initialState(packs)) {
  return events.reduce(
    (state, type) => openingReducer(packs, state, { type } as OpeningEvent),
    start,
  );
}

describe("openingReducer (design doc 08, section 3)", () => {
  it("tears, reveals card by card, summarizes, then moves to the next pack", () => {
    expect(run(["tear"])).toEqual({ phase: "tearing", pack: 0 });
    expect(run(["tear", "tearFinished"])).toEqual({ phase: "revealing", pack: 0, revealed: 0 });
    expect(run(["tear", "tearFinished", "revealNext", "revealNext"])).toEqual({
      phase: "revealing",
      pack: 0,
      revealed: 2,
    });
    expect(run(["tear", "tearFinished", "revealNext", "revealNext", "revealNext"])).toEqual({
      phase: "summary",
      pack: 0,
    });
    expect(run(["tear", "tearFinished", "revealAll", "nextPack"])).toEqual({
      phase: "sealed",
      pack: 1,
    });
  });

  it("finishes after the last pack's summary", () => {
    const lastSummary: OpeningState = { phase: "summary", pack: 1 };
    expect(run(["nextPack"], lastSummary)).toEqual({ phase: "finished" });
  });

  it("ignores events that don't apply, so stray clicks can't skip ahead (rule 4)", () => {
    const sealed = initialState(packs);
    for (const type of ["tearFinished", "revealNext", "revealAll", "nextPack"] as const) {
      expect(run([type], sealed)).toBe(sealed);
    }
    const tearing = run(["tear"]);
    expect(run(["revealNext", "tear", "nextPack"], tearing)).toBe(tearing);
  });

  it("can always skip to the end", () => {
    expect(run(["tear", "skipToEnd"])).toEqual({ phase: "finished" });
  });

  it("starts finished when there's nothing to open", () => {
    expect(initialState([])).toEqual({ phase: "finished" });
  });

  it("counts face-up cards in each phase", () => {
    expect(revealedCount(run([]), packs[0])).toBe(0);
    expect(revealedCount(run(["tear", "tearFinished", "revealNext"]), packs[0])).toBe(1);
    expect(revealedCount({ phase: "summary", pack: 0 }, packs[0])).toBe(3);
  });
});

describe("hitLevel (rule 3)", () => {
  it("makes a fuss about rares, mythics and anything worth $5", () => {
    expect(hitLevel(card("x", "common"))).toBe("none");
    expect(hitLevel(card("x", "rare"))).toBe("rare");
    expect(hitLevel(card("x", "special"))).toBe("rare");
    expect(hitLevel(card("x", "mythic"))).toBe("mythic");
    expect(hitLevel(card("x", "uncommon", 500))).toBe("mythic");
    expect(hitLevel(card("x", "uncommon", 499))).toBe("none");
    expect(hitLevel(card("x", "common", null))).toBe("none");
  });
});

describe("packValueCents", () => {
  it("adds up the prices, counting missing ones as $0", () => {
    expect(
      packValueCents(
        pack(9, [card("a", "common", 10), card("b", "rare", null), card("c", "rare", 250)]),
      ),
    ).toBe(260);
  });
});
