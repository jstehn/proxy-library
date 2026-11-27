import { ok, type UserId } from "@/shared/kernel";
import type { deckView } from "@/modules/decks/core";
import { isPlayed, type DeckLine, type DeckPlan } from "@/modules/decks/core/client";
import {
  castCurveDeltas,
  type deckViewAfterChanges,
  MAX_CURVE_CARDS,
  type DeckChange,
  type PreviewCastCurves,
} from "@/modules/decks/changes";
import { castCurvesOf, COMMANDER_WORD, type CastDeckView } from "@/modules/decks/play";

// Design doc 72: the commander's and the added cards' cast curves, before and after a dry run.
// One seed for both sides, so a difference comes from the change and not from the shuffle.

const RUNS = 2000;
const LAST_TURN = 10;

export type PreviewCurveDependencies = Readonly<{
  readDeck(userId: UserId, deckId: number): ReturnType<typeof deckView>;
  readPlan(userId: UserId, deckId: number): Promise<DeckPlan | null>;
  /** The deck with the changes applied (nothing saved). */
  afterView(
    userId: UserId,
    view: NonNullable<Awaited<ReturnType<typeof deckView>>>,
    changes: readonly DeckChange[],
  ): ReturnType<typeof deckViewAfterChanges>;
  /** The lines with what their cards do when tapped and when played. */
  addFeatures(lines: readonly DeckLine[]): Promise<CastDeckView["lines"]>;
}>;

export function makePreviewCastCurves(dependencies: PreviewCurveDependencies) {
  const { readDeck, readPlan, afterView: viewAfter, addFeatures } = dependencies;

  async function previewCastCurves(
    userId: UserId,
    deckId: number,
    changes: readonly DeckChange[],
  ): Promise<PreviewCastCurves | null> {
    const saved = await readDeck(userId, deckId);
    if (saved === null) return null;
    const [profile, afterView, beforeLines] = await Promise.all([
      readPlan(userId, deckId),
      viewAfter(userId, saved, changes),
      addFeatures(saved.lines),
    ]);
    const beforeView = { ...saved, lines: beforeLines };

    const hasCommander = (view: { lines: readonly { board: string }[] }) =>
      view.lines.some((line) => line.board === "commander");
    const beforeNames = new Set(beforeLines.map((line) => line.name.toLowerCase()));
    const commanderName = afterView.lines.find((line) => line.board === "commander")?.name;
    const addedNames = changes
      .filter((change) => isPlayed(change.board))
      .flatMap((change) => {
        const line = afterView.lines.find(
          (candidate) => candidate.oracleId === change.oracleId && candidate.board === change.board,
        );
        const beforeQuantity = saved.lines
          .filter((candidate) => candidate.oracleId === change.oracleId)
          .reduce((total, candidate) => total + candidate.quantity, 0);
        return line !== undefined && line.quantity > beforeQuantity ? [line.name] : [];
      })
      .filter((name) => name !== commanderName);
    const wanted = [
      ...(hasCommander(afterView) ? [COMMANDER_WORD] : []),
      ...new Set(addedNames),
    ].slice(0, MAX_CURVE_CARDS);
    if (wanted.length === 0) return null;

    const options = {
      onTheDraw: false,
      lastTurn: LAST_TURN,
      runs: RUNS,
      seed: `preview-${deckId}`,
    };
    // A card the deck doesn't have yet can't be cast before the change: it is left out of the
    // "before" run and shown as zeros.
    const beforeCards = wanted.filter((name) =>
      name === COMMANDER_WORD ? hasCommander(beforeView) : beforeNames.has(name.toLowerCase()),
    );
    const before =
      beforeCards.length === 0
        ? ok({ runs: RUNS, marginPct: 0, onTheDraw: false, cards: [] })
        : castCurvesOf(beforeView, profile, { ...options, cards: beforeCards });
    const after = castCurvesOf(afterView, profile, { ...options, cards: wanted });
    if (!before.ok || !after.ok) return null;
    return castCurveDeltas(before.value, after.value);
  }

  return previewCastCurves;
}
