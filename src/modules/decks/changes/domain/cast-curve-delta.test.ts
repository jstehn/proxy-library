import { describe, expect, it } from "vitest";
import { castCurveDeltas, type CurveReport } from "./cast-curve-delta";

function report(cards: CurveReport["cards"], marginPct = 2.2): CurveReport {
  return { runs: 2000, marginPct, onTheDraw: false, cards };
}

describe("castCurveDeltas", () => {
  it("gives zero change and within-noise for identical curves (invariant 2)", () => {
    const same = report([{ card: "Atraxa", byTurnPct: [0, 10, 40, 60], medianTurn: 4 }]);
    const result = castCurveDeltas(same, same);
    expect(result.cards[0].delta).toEqual([0, 0, 0, 0]);
    expect(result.cards[0].withinNoise).toBe(true);
  });

  it("reports a change larger than the margin as real, with both medians", () => {
    const before = report([{ card: "Atraxa", byTurnPct: [0, 10, 40, 60], medianTurn: 4 }]);
    const after = report([{ card: "Atraxa", byTurnPct: [0, 20, 55, 75], medianTurn: 3 }]);
    const [card] = castCurveDeltas(before, after).cards;
    expect(card.delta).toEqual([0, 10, 15, 15]);
    expect(card.medianBefore).toBe(4);
    expect(card.medianAfter).toBe(3);
    expect(card.withinNoise).toBe(false);
  });

  it("treats a change exactly at the margin as noise, and one point over as real", () => {
    const before = report([{ card: "A", byTurnPct: [10], medianTurn: null }], 2);
    const atMargin = report([{ card: "A", byTurnPct: [12], medianTurn: null }], 2);
    const overMargin = report([{ card: "A", byTurnPct: [13], medianTurn: null }], 2);
    expect(castCurveDeltas(before, atMargin).cards[0].withinNoise).toBe(true);
    expect(castCurveDeltas(before, overMargin).cards[0].withinNoise).toBe(false);
  });

  it("uses zeros and a null median for a card the deck did not have before", () => {
    const before = report([{ card: "Atraxa", byTurnPct: [0, 0], medianTurn: null }]);
    const after = report([
      { card: "Atraxa", byTurnPct: [0, 0], medianTurn: null },
      { card: "Sol Ring", byTurnPct: [8, 20], medianTurn: null },
    ]);
    const solRing = castCurveDeltas(before, after).cards[1];
    expect(solRing.before).toEqual([0, 0]);
    expect(solRing.delta).toEqual([8, 20]);
    expect(solRing.medianBefore).toBeNull();
  });
});
