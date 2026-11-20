import { describe, expect, it } from "vitest";
import type { CastReport } from "@/modules/decks";
import { castBars, castCaption, castMedian } from "./cast-bars";

const report: CastReport = {
  runs: 2000,
  marginPct: 2.2,
  onTheDraw: false,
  cards: [
    { card: "Henzie", byTurnPct: [0, 0, 4, 31, 62], medianTurn: 5, misses: "too little mana 20%" },
    { card: "Wurm", byTurnPct: [0, 0, 0, 0, 3], medianTurn: null, misses: "not drawn 60%" },
  ],
};

describe("the cast-by-turn chart's data", () => {
  it("gives one bar per turn, numbered from 1", () => {
    expect(castBars(report.cards[0])).toEqual([
      { turn: 1, pct: 0 },
      { turn: 2, pct: 0 },
      { turn: 3, pct: 4 },
      { turn: 4, pct: 31 },
      { turn: 5, pct: 62 },
    ]);
  });

  it("labels the chart as a measurement from simulated games", () => {
    expect(castCaption(report)).toBe(
      "Castable by turn (2,000 simulated games on the play, ±2.2 points)",
    );
    expect(castCaption({ ...report, onTheDraw: true })).toContain("on the draw");
  });

  it("names the median turn, or says the card is under half by the last turn", () => {
    expect(castMedian(report.cards[0], 5)).toBe("Median turn 5");
    expect(castMedian(report.cards[1], 5)).toBe("Castable in under half the games by turn 5");
  });
});
