import { describe, expect, it } from "vitest";
import type { Color } from "@/modules/catalog";
import { sampleCardFacts, samplePrintingId } from "../testing/samples";
import type { DraftCardFacts } from "./auto-pick";
import type { DraftCard } from "./draft";
import { colorPips, splitLands, suggestBuild } from "./suggested-build";

function pool(facts: readonly DraftCardFacts[]) {
  const lookup = new Map<string, DraftCardFacts>();
  const cards: DraftCard[] = facts.map((each, index) => {
    lookup.set(`card${index}`, each);
    return {
      slot: index,
      printingId: samplePrintingId(`card${index}`),
      finish: "nonfoil",
      pick: { seat: 0, pickNumber: index + 1, auto: false, at: new Date(0) },
    };
  });
  return { cards, lookup: (id: string) => lookup.get(id) };
}

const many = (count: number, overrides: Parameters<typeof sampleCardFacts>[0]) =>
  Array.from({ length: count }, () => sampleCardFacts(overrides));
const total = (basics: ReadonlyArray<{ count: number }>) =>
  basics.reduce((sum, basic) => sum + basic.count, 0);

describe("colorPips", () => {
  it("counts colored symbols, halving hybrids", () => {
    expect(Object.fromEntries(colorPips("{2}{G}{G}"))).toEqual({ G: 2 });
    expect(Object.fromEntries(colorPips("{W/U}{B/P}{2/R}"))).toEqual({
      W: 0.5,
      U: 0.5,
      B: 1,
      R: 1,
    });
    expect(colorPips(null).size).toBe(0);
    expect(colorPips("{X}{C}").size).toBe(0);
  });
});

describe("splitLands", () => {
  it("splits in proportion and always adds up", () => {
    const split = splitLands(
      17,
      new Map<Color, number>([
        ["G", 12],
        ["U", 8],
      ]),
    );
    expect(Object.fromEntries(split)).toEqual({ G: 10, U: 7 });
    const three = splitLands(
      17,
      new Map<Color, number>([
        ["W", 1],
        ["U", 1],
        ["B", 1],
      ]),
    );
    expect([...three.values()].reduce((a, b) => a + b, 0)).toBe(17);
  });
});

describe("suggestBuild (rule 12)", () => {
  it("plays the best 23 in its two colors, 17 basics by pips, and sideboards the rest", () => {
    const facts = [
      ...many(14, { colors: ["G"], rarity: "uncommon" }),
      ...many(12, { colors: ["U"] }),
      ...many(4, { colors: ["R"], rarity: "rare" }),
      sampleCardFacts({ typeLine: "Basic Land — Forest" }),
    ];
    const { cards, lookup } = pool(facts);
    const build = suggestBuild(cards, (id) => lookup(id));

    expect(build.colors).toEqual(["G", "U"]);
    expect(build.main).toHaveLength(23);
    expect(total(build.basics)).toBe(17);
    expect(build.main.length + total(build.basics)).toBe(40);
    // 14 green and 9 blue spells → 14:9 pips → 10 Forests, 7 Islands.
    expect(build.basics).toEqual([
      { color: "U", count: 7 },
      { color: "G", count: 10 },
    ]);
    // The red rares, the spare blues and the drafted Forest are on the sideboard.
    expect(build.side).toHaveLength(facts.length - 23);
    expect(
      build.main.every(
        (card) => !["card26", "card27", "card28", "card29", "card30"].includes(card.printingId),
      ),
    ).toBe(true);
  });

  it("splashes rather than playing extra lands when short of playables", () => {
    const facts = [
      ...many(15, { colors: ["G"] }),
      ...many(4, { colors: ["U"] }),
      ...many(6, { colors: ["R"] }),
    ];
    const { cards, lookup } = pool(facts);
    const build = suggestBuild(cards, (id) => lookup(id));
    expect(build.main).toHaveLength(23);
    expect(total(build.basics)).toBe(17);
  });

  it("plays dual lands in its colors in place of basics", () => {
    const facts = [
      ...many(14, { colors: ["G"] }),
      ...many(10, { colors: ["U"] }),
      sampleCardFacts({ typeLine: "Land", colors: [], producedMana: ["G", "U"] }),
    ];
    const { cards, lookup } = pool(facts);
    const build = suggestBuild(cards, (id) => lookup(id));
    expect(build.main).toHaveLength(24);
    expect(total(build.basics)).toBe(16);
  });
});
