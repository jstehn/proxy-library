import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { library, type DrawLine } from "./draws";
import { simulateOpeningHands } from "./goldfish";

function buildLibrary(landsCount: number, rampCount: number, fillerCount: number) {
  const lines: DrawLine[] = [];
  if (landsCount > 0) {
    lines.push({
      oracleId: "forest",
      name: "Forest",
      printingId: "p-forest",
      board: "main",
      quantity: landsCount,
      typeLine: "Basic Land — Forest",
      manaValue: 0,
      producedMana: ["G"],
    });
  }
  if (rampCount > 0) {
    lines.push({
      oracleId: "elves",
      name: "Llanowar Elves",
      printingId: "p-elves",
      board: "main",
      quantity: rampCount,
      typeLine: "Creature — Elf Druid",
      manaValue: 1,
      text: "{T}: Add {G}.",
      producedMana: ["G"],
    });
  }
  if (fillerCount > 0) {
    lines.push({
      oracleId: "giant",
      name: "Hill Giant",
      printingId: "p-giant",
      board: "main",
      quantity: fillerCount,
      typeLine: "Creature — Giant",
      manaValue: 4,
      text: "",
    });
  }
  return library(lines);
}

describe("simulateOpeningHands", () => {
  it("is deterministic for a fixed seed and respects London mulligan hand sizes", () => {
    const cards = buildLibrary(37, 10, 52);
    const r1 = simulateOpeningHands(cards, { rng: seededRng("goldfish-1"), trials: 200 });
    const r2 = simulateOpeningHands(cards, { rng: seededRng("goldfish-1"), trials: 200 });

    expect(r1).toEqual(r2);
    expect(r1.trials).toBe(200);
    expect(r1.librarySize).toBe(99);
    expect(r1.keepableRatePct).toBeGreaterThan(70);
    expect(r1.keptByMulligan.reduce((a, b) => a + b, 0)).toBe(200);
    expect(r1.sampleHands.length).toBe(3);
  });

  it("shows much lower keepable rate and higher mana screw on a 15-land deck", () => {
    const balanced = buildLibrary(38, 12, 49);
    const starved = buildLibrary(15, 12, 72);

    const ok = simulateOpeningHands(balanced, { rng: seededRng("cmp-1"), trials: 300 });
    const bad = simulateOpeningHands(starved, { rng: seededRng("cmp-1"), trials: 300 });

    expect(ok.keepableRatePct).toBeGreaterThan(bad.keepableRatePct);
    expect(bad.manaScrewPct).toBeGreaterThan(ok.manaScrewPct);
    expect(ok.turn3LandDropPct).toBeGreaterThan(bad.turn3LandDropPct);
  });
});
