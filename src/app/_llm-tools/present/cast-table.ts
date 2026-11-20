import type { CastReport } from "@/modules/decks";

/**
 * The cast curve for a model: a header, then one short line per turn ("T3 8% 41%": the chance
 * of having cast each card by then). A measurement from simulated games, not a score.
 */
export function castTable(report: CastReport) {
  const turns = Math.max(...report.cards.map((card) => card.byTurnPct.length));
  return {
    runs: report.runs,
    marginPct: report.marginPct,
    side: report.onTheDraw ? "draw" : "play",
    cards: report.cards.map((card) => card.card),
    table: Array.from(
      { length: turns },
      (_, turn) =>
        `T${turn + 1} ${report.cards.map((card) => `${card.byTurnPct[turn]}%`).join(" ")}`,
    ),
    medianTurn: report.cards.map((card) => card.medianTurn),
    misses: report.cards.map((card) => card.misses),
  };
}
