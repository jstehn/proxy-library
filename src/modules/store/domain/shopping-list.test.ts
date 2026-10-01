import { describe, expect, it } from "vitest";
import { parseList } from "@/shared/card-search";
import {
  MAX_LIST_LINES,
  nameKey,
  quoteList,
  type CatalogAnswers,
  type Candidate,
  type QuoteOptions,
} from "./shopping-list";

const candidate = (changes: Partial<Candidate>): Candidate => ({
  printingId: "p",
  oracleId: "bolt",
  name: "Lightning Bolt",
  setCode: "M11",
  setName: "Magic 2011",
  collectorNumber: "149",
  variantLabel: "",
  releaseDate: "2010-07-16",
  finish: "nonfoil",
  priceCents: 100,
  ...changes,
});

const BOLTS = [
  candidate({ printingId: "m11", priceCents: 150 }),
  candidate({
    printingId: "2xm",
    setCode: "2XM",
    collectorNumber: "123",
    releaseDate: "2020-08-07",
    priceCents: 90,
  }),
  candidate({
    printingId: "sta",
    setCode: "STA",
    collectorNumber: "42",
    releaseDate: "2021-04-23",
    priceCents: 400,
  }),
  candidate({
    printingId: "sta-foil",
    setCode: "STA",
    collectorNumber: "42",
    releaseDate: "2021-04-23",
    finish: "foil",
    priceCents: 900,
  }),
];
const RING = candidate({
  printingId: "ring",
  oracleId: "ring",
  name: "The One Ring",
  setCode: "LTR",
  collectorNumber: "246",
  finish: "foil",
  priceCents: 14_000,
});

const answers = (owned: Record<string, number> = {}): CatalogAnswers => ({
  forSale: new Map([
    ["lightning bolt", BOLTS],
    ["the one ring", [RING]],
  ]),
  known: new Set(["lightning bolt", "the one ring", "black lotus"]),
  owned: new Map(Object.entries(owned)),
});

const DEFAULTS: QuoteOptions = { preference: "cheapest", onlyMissing: true, chosen: {} };

function quote(
  text: string,
  owned: Record<string, number> = {},
  options: Partial<QuoteOptions> = {},
) {
  const parsed = parseList(text);
  return quoteList(parsed.lines, parsed.unreadable, answers(owned), { ...DEFAULTS, ...options });
}

describe("quoteList", () => {
  it("picks the cheapest printing by default, the newest when asked", () => {
    expect(quote("4 Lightning Bolt").lines[0]).toMatchObject({
      choice: { printingId: "2xm" },
      toBuy: 4,
      totalCents: 360,
    });
    expect(
      quote("4 lightning bolt", {}, { preference: "newest" }).lines[0].choice?.printingId,
    ).toBe("sta");
  });

  it("follows a set and number, then a set, and a printing picked on the screen wins", () => {
    expect(quote("1 Lightning Bolt (M11) 149").lines[0].choice?.printingId).toBe("m11");
    expect(quote("1 Lightning Bolt (STA)").lines[0].choice?.printingId).toBe("sta");
    expect(
      quote("1 Lightning Bolt", {}, { chosen: { 0: "m11" } }).lines[0].choice?.printingId,
    ).toBe("m11");
  });

  it("buys only what you don't own, using owned copies once across lines", () => {
    const result = quote("4 Lightning Bolt\n4 Lightning Bolt", { bolt: 5 });
    expect(result.lines.map((line) => line.toBuy)).toEqual([0, 3]);
    expect(result.cards).toBe(3);
    expect(quote("4 Lightning Bolt", { bolt: 5 }, { onlyMissing: false }).cards).toBe(4);
  });

  it("explains every line it can't buy, and leaves it out of the total", () => {
    const result = quote(
      "1 Black Lotus\n1 Bolt Thing\n1 The One Ring\n1 Lightning Bolt (STA) 999\n2 Lightning Bolt *F*\n1 The One Ring *F*",
    );
    expect(result.lines.map((line) => line.problem)).toEqual([
      "not sold here (its sets aren't in the store)",
      "no card by that name",
      "no nonfoil printing for sale (sold as foil: mark it *F*)",
      "no nonfoil printing STA #999 for sale",
      null,
      null,
    ]);
    expect(result.totalCents).toBe(2 * 900 + 14_000);
    expect(result.cards).toBe(3);
  });

  it("keeps the unreadable lines, and stops at the line limit", () => {
    const result = quote("hello (\n0 Bolt");
    expect(result.unreadable).toEqual(["0 Bolt"]);
    const long = quote(
      Array.from({ length: MAX_LIST_LINES + 5 }, () => "1 Lightning Bolt").join("\n"),
    );
    expect(long.lines).toHaveLength(MAX_LIST_LINES);
    expect(long.leftOut).toBe(5);
  });

  it("matches names regardless of case and spacing", () => {
    expect(nameKey("  The ONE Ring ")).toBe("the one ring");
  });
});
