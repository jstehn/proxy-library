import { describe, expect, it } from "vitest";
import { sampleGain } from "../testing/fakes";
import { combineGains } from "./cards";

describe("combineGains", () => {
  it("adds up copies of the same printing and finish", () => {
    expect(combineGains([sampleGain("a", 1), sampleGain("b", 1), sampleGain("a", 2)])).toEqual([
      sampleGain("a", 3),
      sampleGain("b", 1),
    ]);
  });

  it("keeps finishes apart", () => {
    expect(combineGains([sampleGain("a", 1), sampleGain("a", 1, "foil")])).toHaveLength(2);
  });

  it("drops changes that cancel out, and refuses fractions", () => {
    expect(combineGains([sampleGain("a", 2), sampleGain("a", -2)])).toEqual([]);
    expect(() => combineGains([sampleGain("a", 0.5)])).toThrow(RangeError);
  });
});
