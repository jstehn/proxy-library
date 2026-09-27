import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceSnapshots, standardSetCodes } from "../domain/rules";
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

  it("flags the synthetic digital card and the Spanish printing", () => {
    expect(lines.filter((card) => card.isDigital)).toHaveLength(1);
    expect(lines.filter((card) => card.language !== "en")).toHaveLength(1);
  });
});

describe("standardSetCodes", () => {
  it("counts paper expansion/core sets with Standard-legal cards, and nothing digital", () => {
    const codes = standardSetCodes(lines);
    expect(codes.has("BLB" as never)).toBe(true);
    expect(codes.has("SPG" as never)).toBe(false); // a "masterpiece" set, not expansion/core
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
