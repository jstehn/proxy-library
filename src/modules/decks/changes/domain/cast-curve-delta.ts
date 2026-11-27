// Cast curves in a deck preview (design doc 72): the commander's and the added cards' chance of
// being cast by each turn, before and after the change. Pure: the simulator runs elsewhere.

/** One card's curve as the simulator reports it (the shape of `CastReport["cards"][number]`). */
export type CurveReading = Readonly<{
  card: string;
  /** Cumulative percent chance of having cast it by turn 1, 2, … */
  byTurnPct: readonly number[];
  medianTurn: number | null;
}>;

/** The simulator's report for one deck, in the shape this module needs. */
export type CurveReport = Readonly<{
  runs: number;
  /** Half the 95% interval, in percentage points, worst case. */
  marginPct: number;
  onTheDraw: boolean;
  cards: readonly CurveReading[];
}>;

/** One card's curve on both sides of a preview. */
export type CastCurveDelta = Readonly<{
  card: string;
  /** Percent by turn, first entry is turn 1. All zeros for a card the deck doesn't have yet. */
  before: readonly number[];
  after: readonly number[];
  /** `after - before` per turn, in percentage points. */
  delta: readonly number[];
  medianBefore: number | null;
  medianAfter: number | null;
  /** No turn's change is larger than the margin of error: do not read it as a gain or a loss. */
  withinNoise: boolean;
}>;

export type PreviewCastCurves = Readonly<{
  runs: number;
  marginPct: number;
  onTheDraw: boolean;
  cards: readonly CastCurveDelta[];
}>;

/** How many cards a preview shows curves for: the commander, then the cards the change adds. */
export const MAX_CURVE_CARDS = 5;

/**
 * Pairs each card of the "after" report with the same card before the change. A card the deck
 * didn't have before (an added one) has no "before" reading: it can't be cast, so zeros.
 */
export function castCurveDeltas(before: CurveReport, after: CurveReport): PreviewCastCurves {
  const beforeByName = new Map(before.cards.map((reading) => [reading.card, reading]));
  const cards = after.cards.map((reading): CastCurveDelta => {
    const earlier = beforeByName.get(reading.card);
    const beforeTurns = reading.byTurnPct.map((_, turn) => earlier?.byTurnPct[turn] ?? 0);
    const delta = reading.byTurnPct.map((percent, turn) => percent - beforeTurns[turn]);
    return {
      card: reading.card,
      before: beforeTurns,
      after: reading.byTurnPct,
      delta,
      medianBefore: earlier?.medianTurn ?? null,
      medianAfter: reading.medianTurn,
      withinNoise: delta.every((change) => Math.abs(change) <= after.marginPct),
    };
  });
  return { runs: after.runs, marginPct: after.marginPct, onTheDraw: after.onTheDraw, cards };
}
