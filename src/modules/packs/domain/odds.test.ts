import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { SAMPLE_BOOSTER, sampleFacts } from "../testing/recipes";
import { generatePack } from "./generate";
import { COUNT_KEYS, expectedPerPack, observedPerPack } from "./odds";

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
