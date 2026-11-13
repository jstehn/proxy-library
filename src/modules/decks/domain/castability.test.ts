import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { simulateCastOnCurve, type CastabilityLine } from "./castability";

function spell(name: string, manaCost: string, manaValue: number, quantity = 1): CastabilityLine {
  return {
    oracleId: `spell-${name}`,
    name,
    board: "main",
    quantity,
    typeLine: "Creature — Elf",
    manaValue,
    manaCost,
    producedMana: [],
    text: "",
  };
}

function land(
  name: string,
  producedMana: readonly string[],
  quantity: number,
  text = "",
): CastabilityLine {
  return {
    oracleId: `land-${name}`,
    name,
    board: "main",
    quantity,
    typeLine: "Land",
    manaValue: 0,
    manaCost: null,
    producedMana,
    text,
  };
}

describe("simulateCastOnCurve", () => {
  it("is deterministic for a fixed seed and identifies bottleneck colors", () => {
    const deck: CastabilityLine[] = [
      land("Forest", ["G"], 32),
      land("Swamp", ["B"], 4),
      spell("Llanowar Elves", "{G}", 1),
      spell("Phyrexian Obliterator", "{B}{B}{B}{B}", 4),
      ...Array.from({ length: 62 }, (_, i) => spell(`Filler ${i}`, "{2}{G}", 3)),
    ];

    const a = simulateCastOnCurve(deck, { rng: seededRng("test-seed"), trials: 300 });
    const b = simulateCastOnCurve(deck, { rng: seededRng("test-seed"), trials: 300 });
    expect(a).toEqual(b);

    const obliterator = a.spells.find((s) => s.name === "Phyrexian Obliterator");
    const elves = a.spells.find((s) => s.name === "Llanowar Elves");
    expect(obliterator).toBeDefined();
    expect(elves).toBeDefined();
    expect(obliterator?.castOnCurvePct).toBeLessThan(0.2);
    expect(obliterator?.bottleneckColor).toBe("B");
    expect(elves?.castOnCurvePct).toBeGreaterThan(0.8);
    expect(a.struggling.some((s) => s.name === "Phyrexian Obliterator")).toBe(true);
  });

  it("improves castability when untapped colored sources replace off-color lands", () => {
    const base: CastabilityLine[] = [
      land("Forest", ["G"], 34),
      land("Swamp", ["B"], 2),
      spell("Necropotence", "{B}{B}{B}", 3),
      ...Array.from({ length: 62 }, (_, i) => spell(`Filler ${i}`, "{1}{G}", 2)),
    ];
    const fixed: CastabilityLine[] = [
      land("Forest", ["G"], 20),
      land("Swamp", ["B"], 16),
      spell("Necropotence", "{B}{B}{B}", 3),
      ...Array.from({ length: 62 }, (_, i) => spell(`Filler ${i}`, "{1}{G}", 2)),
    ];

    const before = simulateCastOnCurve(base, { rng: seededRng("mono"), trials: 400 });
    const after = simulateCastOnCurve(fixed, { rng: seededRng("mono"), trials: 400 });

    const necroBefore = before.spells.find((s) => s.name === "Necropotence")?.castOnCurvePct ?? 0;
    const necroAfter = after.spells.find((s) => s.name === "Necropotence")?.castOnCurvePct ?? 0;
    expect(necroAfter).toBeGreaterThan(necroBefore);
  });
});
