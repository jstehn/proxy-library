import type { CastReport } from "@/modules/decks";

/**
 * The cast curve for a model, one entry per card: the chance of having cast it by turn 1, 2, …
 * as one space-separated string (read left to right, turn 1 first), the median turn and why games
 * missed. A measurement from simulated games, not a score.
 */
export function castTable(report: CastReport) {
  return {
    runs: report.runs,
    marginPct: report.marginPct,
    side: report.onTheDraw ? "draw" : "play",
    pctByTurn: "cumulative percent by turn 1, 2, … (space separated)",
    cards: report.cards.map((card) => ({
      card: card.card,
      pct: card.byTurnPct.join(" "),
      medianTurn: card.medianTurn,
      ...(card.misses !== "" ? { misses: card.misses } : {}),
    })),
  };
}
