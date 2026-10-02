import { describe, expect, it } from "vitest";
import { columnOf, curveOf, manaValueOf, poolColumns, stacksOf, type FaceFacts } from "./pool";

const card = (manaCost: string | null, typeLine = "Creature"): FaceFacts => ({
  manaCost,
  typeLine,
});

describe("columnOf", () => {
  it("sorts by the colors a cost shows, with lands apart", () => {
    expect(columnOf(card("{1}{G}"))).toBe("G");
    expect(columnOf(card("{G}{U}"))).toBe("multicolor");
    expect(columnOf(card("{G/U}"))).toBe("multicolor");
    expect(columnOf(card("{3}", "Artifact"))).toBe("colorless");
    expect(columnOf(card(null, "Basic Land — Forest"))).toBe("land");
    expect(columnOf(undefined)).toBe("colorless");
  });
});

describe("manaValueOf", () => {
  it("adds numbers and symbols, with X as zero", () => {
    expect(manaValueOf("{2}{W}{W}")).toBe(4);
    expect(manaValueOf("{X}{R}")).toBe(1);
    expect(manaValueOf("{W/U}{2/B}")).toBe(2);
    expect(manaValueOf(null)).toBe(0);
  });
});

describe("poolColumns and curveOf", () => {
  it("groups in WUBRG order, cheapest first, and counts the curve without lands", () => {
    const pool = [card("{4}{G}"), card("{W}"), card("{G}"), card(null, "Land"), card("{7}")];
    expect(
      poolColumns(pool, (each) => each).map((group) => [group.column, group.cards.length]),
    ).toEqual([
      ["W", 1],
      ["G", 2],
      ["colorless", 1],
      ["land", 1],
    ]);
    expect(poolColumns(pool, (each) => each)[1].cards.map((each) => each.manaCost)).toEqual([
      "{G}",
      "{4}{G}",
    ]);
    expect(curveOf(pool, (each) => each)).toEqual([2, 0, 0, 0, 1, 1]);
  });
});

describe("stacksOf", () => {
  it("counts copies, keeping the order they first appear in", () => {
    const stacks = stacksOf(["b", "a", "b", "c", "b"], (card) => card);
    expect(stacks.map((stack) => [stack.card, stack.count])).toEqual([
      ["b", 3],
      ["a", 1],
      ["c", 1],
    ]);
  });
});
