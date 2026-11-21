import type { CastReport } from "@/modules/decks";

// What the cast-by-turn chart shows, from the capability's report. Plain data, so the chart and
// its test both use it.

export type CastBar = Readonly<{ turn: number; pct: number }>;

type CastedCard = CastReport["cards"][number];

/** One bar per turn: the measured chance of having cast the card by then. */
export function castBars(card: CastedCard): CastBar[] {
  return card.byTurnPct.map((pct, index) => ({ turn: index + 1, pct }));
}

/** The chart's heading line: how many games, and how sure the numbers are. */
export function castCaption(report: CastReport): string {
  const side = report.onTheDraw ? "on the draw" : "on the play";
  return `Castable by turn (${report.runs.toLocaleString("en-US")} simulated games ${side}, ±${report.marginPct} points)`;
}

/** The median turn in words, or that half the games never got there. */
export function castMedian(card: CastedCard, lastTurn: number): string {
  return card.medianTurn === null
    ? `Castable in under half the games by turn ${lastTurn}`
    : `Median turn ${card.medianTurn}`;
}
