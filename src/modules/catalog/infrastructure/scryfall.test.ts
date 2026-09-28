import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  priceSnapshots,
  standardSetsFromTally,
  tallyStandard,
  type StandardTally,
} from "../domain/rules";
import { PrintingId } from "../domain/types";
import { mapScryfallCard, ScryfallCardSchema } from "./scryfall";

// Real Scryfall lines for the fixture printings, plus 2 synthetic ones (tests/fixtures/README.md).
const lines = readFileSync("tests/fixtures/scryfall/default-cards.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((line) => mapScryfallCard(ScryfallCardSchema.parse(JSON.parse(line))));

describe("mapScryfallCard", () => {
  it("parses prices per finish into cents, with null for a missing price", () => {
    const banishingLight = lines[0];
    expect(banishingLight.prices.nonfoil).toBeTypeOf("number");
    expect(banishingLight.prices.etched).toBeNull();
  });

  it("reads image addresses for the front face", () => {
    expect(lines[0].images?.front.normal).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\//);
    expect(lines[0].images?.back).toBeNull();
  });

  it("flags the synthetic digital card, and reads the Spanish and Japanese-only printings' language", () => {
    expect(lines.filter((card) => card.isDigital)).toHaveLength(1);
    expect(lines.filter((card) => card.language !== "en").map((card) => card.language)).toEqual([
      "es",
      "ja",
    ]);
  });
});

describe("Standard detection", () => {
  it("counts sets where most non-basic English paper cards are Standard-legal", () => {
    const tally: StandardTally = new Map();
    for (const card of lines) tallyStandard(tally, card);
    expect(standardSetsFromTally(tally)).toEqual(["BLB"]); // SPG is a "masterpiece" set
  });

  it("ignores basic lands, which are legal in every set", () => {
    const tally: StandardTally = new Map();
    const oldBasic = {
      ...lines[0],
      setCode: "LEA" as never,
      isStandardLegal: true,
      isBasicLand: true,
    };
    const oldCard = {
      ...lines[0],
      setCode: "LEA" as never,
      isStandardLegal: false,
      isBasicLand: false,
    };
    tallyStandard(tally, oldBasic);
    tallyStandard(tally, oldCard);
    expect(standardSetsFromTally(tally)).toEqual([]);
  });

  it("ignores an old set with a few Standard-legal reprints", () => {
    const tally: StandardTally = new Map();
    const card = (legal: boolean) => ({
      ...lines[0],
      setCode: "M19" as never,
      isStandardLegal: legal,
    });
    for (let i = 0; i < 15; i++) tallyStandard(tally, card(true));
    for (let i = 0; i < 85; i++) tallyStandard(tally, card(false));
    expect(standardSetsFromTally(tally)).toEqual([]);
  });
});

describe("priceSnapshots", () => {
  it("makes one snapshot per finish that has a price", () => {
    const card = {
      prices: { nonfoil: 12 as never, foil: 34 as never, etched: null },
    };
    const printing = { id: PrintingId.of("p1"), finishes: ["nonfoil", "foil", "etched"] as const };
    expect(priceSnapshots(printing, card, "2026-09-27")).toEqual([
      { printingId: "p1", finish: "nonfoil", day: "2026-09-27", price: 12 },
      { printingId: "p1", finish: "foil", day: "2026-09-27", price: 34 },
    ]);
  });

  it("ignores prices for finishes the printing doesn't have", () => {
    const card = { prices: { nonfoil: 12 as never, foil: 34 as never, etched: null } };
    const foilOnly = { id: PrintingId.of("p2"), finishes: ["foil"] as const };
    expect(priceSnapshots(foilOnly, card, "2026-09-27")).toHaveLength(1);
  });
});
