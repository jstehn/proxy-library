import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import type { LibraryCard } from "./draws";
import { dealMulliganDrill, evaluateMulliganDecision } from "./mulligan-trainer";

function makeCard(i: number, isLand: boolean, manaValue = 2, ramp = false): LibraryCard {
  return {
    key: `card-${i}#1`,
    oracleId: `card-${i}`,
    name: isLand ? `Forest ${i}` : `Spell ${i}`,
    printingId: `p-${i}`,
    isLand,
    ...(isLand ? {} : { manaValue }),
    tags: ramp ? ["ramp"] : [],
  };
}

describe("mulligan trainer", () => {
  it("recommends keeping a 3-land hand with early ramp", () => {
    const cards: LibraryCard[] = [
      makeCard(1, true),
      makeCard(2, true),
      makeCard(3, true),
      makeCard(4, false, 2, true),
      makeCard(5, false, 3, false),
      makeCard(6, false, 4, false),
      makeCard(7, false, 5, false),
    ];

    const drill = dealMulliganDrill(cards, seededRng("1"));
    expect(drill.hand).toHaveLength(7);
    expect(drill.landCount).toBe(3);
    expect(drill.earlyRampCount).toBe(1);
    expect(drill.recommended).toBe("keep");

    const evalKeep = evaluateMulliganDecision(drill, "keep");
    expect(evalKeep.correct).toBe(true);
    const evalMull = evaluateMulliganDecision(drill, "mulligan");
    expect(evalMull.correct).toBe(false);
  });

  it("recommends mulliganing a 1-land hand", () => {
    const cards: LibraryCard[] = [
      makeCard(1, true),
      makeCard(2, false, 2, true),
      makeCard(3, false, 3, false),
      makeCard(4, false, 4, false),
      makeCard(5, false, 5, false),
      makeCard(6, false, 6, false),
      makeCard(7, false, 7, false),
    ];

    const drill = dealMulliganDrill(cards, seededRng("2"));
    expect(drill.landCount).toBe(1);
    expect(drill.recommended).toBe("mulligan");
    expect(drill.reasons[0]).toContain("Only 1 land");
  });

  it("computes keepCount using London mulligan rules with optional free first mulligan", () => {
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(i, i < 4));
    expect(dealMulliganDrill(cards, seededRng("3"), { mulliganCount: 0 }).keepCount).toBe(7);
    expect(
      dealMulliganDrill(cards, seededRng("3"), { mulliganCount: 1, freeFirstMulligan: true })
        .keepCount,
    ).toBe(7);
    expect(
      dealMulliganDrill(cards, seededRng("3"), { mulliganCount: 2, freeFirstMulligan: true })
        .keepCount,
    ).toBe(6);
    expect(
      dealMulliganDrill(cards, seededRng("3"), { mulliganCount: 1, freeFirstMulligan: false })
        .keepCount,
    ).toBe(6);
  });
});
