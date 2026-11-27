import type {
  DeckChangePreview,
  DeckProblem,
  PreviewCastCurves,
  PreviewWarning,
} from "@/modules/decks";
import {
  bracketWarningText,
  estimateLabel,
  findingWithCards,
  problemText,
  TAG_LABELS,
} from "@/app/decks/labels";
import { money } from "../tool";

const roundTwo = (value: number) => Math.round(value * 100) / 100;

function summarizeRemainingProblems(problems: readonly DeckProblem[]): string[] {
  const nonShort = problems.filter((p) => p.kind !== "Short").map(problemText);
  const shortCount = problems.length - nonShort.length;
  if (shortCount <= 5) return problems.map(problemText);
  return [...nonShort, `${shortCount} short card(s) (see shortTotal / deck_facts)`];
}

/** The dry run (or the saved changes) as the model reads it: before, after, roles, problems. */
export function presentChangePreview(
  preview: DeckChangePreview,
  saved: Readonly<{ saved: boolean; fingerprint: string }>,
) {
  return {
    deck: preview.deck,
    format: preview.format,
    targetSize: preview.targetSize,
    saved: saved.saved,
    fingerprint: saved.fingerprint,
    changes: preview.changes.map((change) => ({
      card: change.name,
      board: change.board,
      before: change.beforeQuantity,
      after: change.afterQuantity,
    })),
    before: {
      cardCount: preview.before.stats.cardCount,
      lands: preview.before.stats.lands,
      otherManaSources: preview.before.stats.otherManaSources,
      averageManaValue: roundTwo(preview.before.stats.averageManaValue),
      curve: preview.before.stats.curve,
      pips: preview.before.stats.pips,
      sources: preview.before.stats.sources,
      value: money(preview.before.stats.priceCents),
      shortTotal: preview.before.shortTotal,
    },
    after: {
      cardCount: preview.after.stats.cardCount,
      lands: preview.after.stats.lands,
      otherManaSources: preview.after.stats.otherManaSources,
      averageManaValue: roundTwo(preview.after.stats.averageManaValue),
      curve: preview.after.stats.curve,
      pips: preview.after.stats.pips,
      sources: preview.after.stats.sources,
      value: money(preview.after.stats.priceCents),
      shortTotal: preview.after.shortTotal,
    },
    priceDelta: money(preview.priceDeltaCents),
    roles: preview.roles
      .filter((role) => role.before !== role.after || role.target !== null)
      .map((role) => ({
        role: role.tag,
        label: TAG_LABELS[role.tag],
        before: role.before,
        after: role.after,
        target: role.target,
        ...(role.added.length > 0 ? { added: role.added } : {}),
        ...(role.removed.length > 0 ? { removed: role.removed } : {}),
      })),
    newlyMetRoles: preview.newlyMetRoles,
    newlyMissedRoles: preview.newlyMissedRoles,
    problems: {
      added: preview.problems.added.map(problemText),
      resolved: preview.problems.resolved.map(problemText),
      remaining: summarizeRemainingProblems(preview.problems.remaining),
    },
    newlyShort: preview.newlyShort.map((short) => ({
      card: short.name,
      needed: short.needed,
      owned: short.owned,
      missing: short.needed - short.owned,
    })),
    bracket:
      preview.bracket.before === null || preview.bracket.after === null
        ? null
        : {
            target: preview.targetBracket,
            before: estimateLabel(preview.bracket.before),
            after: estimateLabel(preview.bracket.after),
            findingsAfter: preview.bracket.after.findings.map(findingWithCards),
            overTargetAfter:
              preview.bracket.warningAfter === null
                ? null
                : bracketWarningText(preview.bracket.warningAfter),
          },
  };
}

/** What a change does to the deck's key cards and avoid cards, as sentences. */
export function presentPreviewWarnings(warnings: readonly PreviewWarning[]): string[] {
  return warnings.map((warning) => {
    const reason = warning.reason === null ? "" : ` — ${warning.reason}`;
    if (warning.kind === "KeyCardCut") {
      return `Cutting ${warning.pinned ? "pinned " : ""}keyCard: ${warning.card} (${warning.board} ${warning.before} -> ${warning.after})${reason}`;
    }
    return `Adding avoid card: ${warning.card}${reason}`;
  });
}

/**
 * The cast-by-turn curves of a preview as the model reads them: per card the percent chance of
 * having cast it by turn 1, 2, … before and after, and the change. Measured by simulation: a change
 * smaller than `marginPct` points is noise (design doc 72).
 */
export function presentCastCurves(curves: PreviewCastCurves) {
  return {
    runs: curves.runs,
    marginPct: curves.marginPct,
    onTheDraw: curves.onTheDraw,
    cards: curves.cards.map((card) => ({
      card: card.card,
      before: card.before,
      after: card.after,
      change: card.delta,
      medianTurn: { before: card.medianBefore, after: card.medianAfter },
      ...(card.withinNoise ? { note: "within the margin of error: no clear change" } : {}),
    })),
  };
}
