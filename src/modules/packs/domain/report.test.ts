import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import { SAMPLE_BOOSTER, sampleFacts } from "../testing/recipes";
import { openPack } from "./generate";
import { BEST_PULLS_SHOWN, packValue, SAMPLE_PACKS_SHOWN, summarizeOpenings } from "./report";

const packs = Array.from({ length: 1_000 }, (_, index) =>
  openPack(SAMPLE_BOOSTER, sampleFacts, `report-${index + 1}`),
);
const report = summarizeOpenings({ config: SAMPLE_BOOSTER, facts: sampleFacts, seed: "s", packs });

describe("summarizeOpenings", () => {
  it("averages the packs' market value, rounding down to the cent", () => {
    const total = packs.reduce((sum, pack) => sum + packValue(pack, sampleFacts), 0);
    expect(report.averageValue).toBe(Math.floor(total / packs.length));
  });

  it("lists the most valuable cards seen, best first, each printing and finish once", () => {
    expect(report.bestPulls.length).toBeLessThanOrEqual(BEST_PULLS_SHOWN);
    expect(report.bestPulls[0]).toMatchObject({ printingId: "m-1", finish: "foil", price: 4000 });
    const prices = report.bestPulls.map((pull) => pull.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    const keys = report.bestPulls.map((pull) => `${pull.printingId}/${pull.finish}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts how often each best pull came up", () => {
    const nonfoilMythic = report.bestPulls.find(
      (pull) => pull.printingId === "m-1" && pull.finish === "nonfoil",
    );
    const timesSeen = packs
      .flatMap((pack) => pack.cards)
      .filter((card) => card.printingId === "m-1" && card.finish === "nonfoil").length;
    expect(nonfoilMythic?.timesPulled).toBe(timesSeen);
  });

  it("keeps a few sample packs, and the counts", () => {
    expect(report.samplePacks).toEqual(packs.slice(0, SAMPLE_PACKS_SHOWN));
    expect(report.packCount).toBe(1_000);
    expect(report.expected.common).toBeCloseTo(9.9);
  });

  it("values an empty run at zero", () => {
    const empty = summarizeOpenings({
      config: SAMPLE_BOOSTER,
      facts: sampleFacts,
      seed: "s",
      packs: [],
    });
    expect(empty.averageValue).toBe(Cents.zero);
    expect(empty.bestPulls).toEqual([]);
  });
});
