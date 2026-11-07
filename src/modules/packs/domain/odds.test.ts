import { describe, expect, it } from "vitest";
import type { PrintingId } from "@/modules/catalog";
import { Cents, seededRng } from "@/shared/kernel";
import {
  SAMPLE_BOOSTER,
  SAMPLE_FACTS,
  sampleFacts,
  sampleSheet,
  withSheet,
} from "../testing/recipes";
import { generatePack } from "./generate";
import { COUNT_KEYS, expectedPackValue, expectedPerPack, observedPerPack } from "./odds";
import { marketValue } from "./pack";

describe("expectedPerPack", () => {
  it("works the sample booster's odds out exactly", () => {
    // Worked by hand, weighting layout A by 3/4 and layout B by 1/4:
    // commons  A: 6 + land 1 + starter 3 = 10   B: 6 + starter 3 + foil 12/20 = 9.6  → 9.9
    // uncommon A: 3                            B: 3 + foil 4/20 = 3.2              → 3.05
    // rare     A: 6/8                          B: 6/8 + foil 2/20                  → 0.775
    // mythic   A: 2/8                          B: 2/8 + foil 2/20                  → 0.275
    // foil     both: the etched mythic, 1/8;   B: + the foil slot, 1               → 0.375
    const expected = expectedPerPack(SAMPLE_BOOSTER, sampleFacts);
    expect(expected.common).toBeCloseTo(9.9);
    expect(expected.uncommon).toBeCloseTo(3.05);
    expect(expected.rare).toBeCloseTo(0.775);
    expect(expected.mythic).toBeCloseTo(0.275);
    expect(expected.foil).toBeCloseTo(0.375);
    expect(expected.special).toBe(0);
  });

  it("adds up to the pack size", () => {
    const expected = expectedPerPack(SAMPLE_BOOSTER, sampleFacts);
    const cards = COUNT_KEYS.filter((key) => key !== "foil").reduce(
      (total, key) => total + expected[key],
      0,
    );
    expect(cards).toBeCloseTo(14);
  });
});

describe("observedPerPack", () => {
  it("matches the expected odds over many packs", () => {
    const packs = Array.from(
      { length: 10_000 },
      (_, index) => generatePack(SAMPLE_BOOSTER, seededRng(`odds-${index}`), sampleFacts).cards,
    );
    const observed = observedPerPack(packs, sampleFacts);
    const expected = expectedPerPack(SAMPLE_BOOSTER, sampleFacts);
    for (const key of COUNT_KEYS) {
      expect(Math.abs(observed[key] - expected[key])).toBeLessThan(0.03);
    }
  });

  it("is all zeros for no packs", () => {
    expect(observedPerPack([], sampleFacts).common).toBe(0);
  });
});

describe("expectedPackValue (design doc 27, section 3.1)", () => {
  const lookup = (printingId: PrintingId) => SAMPLE_FACTS.get(printingId);

  it("is the average market value of many opened packs", () => {
    const packs = Array.from({ length: 20_000 }, (_, index) =>
      generatePack(SAMPLE_BOOSTER, seededRng(`value-${index}`), sampleFacts),
    );
    const valueOf = (pack: (typeof packs)[number]) =>
      pack.cards.reduce((sum, card) => sum + marketValue(card, sampleFacts), 0);
    const average = packs.reduce((sum, pack) => sum + valueOf(pack), 0) / packs.length;
    const expected = expectedPackValue(SAMPLE_BOOSTER, lookup);
    expect(expected).toBeGreaterThan(0);
    expect(Math.abs(average - expected) / expected).toBeLessThan(0.02);
  });

  it("counts a card the catalog doesn't have as $0, and an empty recipe as nothing", () => {
    const withoutAny = expectedPackValue(SAMPLE_BOOSTER, () => undefined);
    expect(withoutAny).toBe(0);
    expect(expectedPackValue({ ...SAMPLE_BOOSTER, variants: [] }, lookup)).toBe(0);
  });

  it("works one slot out by hand: one card from $1 (weight 3) and $5 (weight 1) is $2", () => {
    const config = withSheet(
      "tiny",
      sampleSheet([
        ["cheap", 3],
        ["dear", 1],
      ]),
      { tiny: 1 },
    );
    const prices: Record<string, number> = { cheap: 100, dear: 500 };
    const value = expectedPackValue(config, (printingId) => ({
      ...sampleFacts(SAMPLE_BOOSTER.sheets.common.cards[0].printingId),
      finishes: ["nonfoil"],
      marketPrice: { nonfoil: Cents.of(prices[printingId]) },
    }));
    expect(value).toBeCloseTo(200);
  });
});
