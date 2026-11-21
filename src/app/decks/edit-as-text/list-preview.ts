import type { DeckChangePreview } from "@/modules/decks";
import { bracketWarningText, estimateLabel, problemText, TAG_LABELS } from "../labels";

// What the "Preview changes" button shows, made from a capability's answer. Kept out of actions.ts
// (design doc 40, section 6; removal-list row "ListPreviewSummary mapping").

/** Summary shown by the "Preview changes" button inside Edit as text. */
export type ListPreviewSummary = Readonly<{
  beforeCards: number;
  afterCards: number;
  targetSize: number;
  exactSize: boolean;
  beforeAverageManaValue: number;
  afterAverageManaValue: number;
  roles: ReadonlyArray<{
    tag: string;
    label: string;
    before: number;
    after: number;
    target: number | null;
  }>;
  problemsAdded: string[];
  problemsResolved: string[];
  problemsRemainingCount: number;
  bracketBefore: string | null;
  bracketAfter: string | null;
  bracketWarningAfter: string | null;
  changes: ReadonlyArray<{
    name: string;
    board: string;
    before: number;
    after: number;
  }>;
}>;

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

export function presentListPreview(preview: DeckChangePreview): ListPreviewSummary {
  const { before, after, problems, bracket } = preview;
  return {
    beforeCards: before.stats.cardCount,
    afterCards: after.stats.cardCount,
    targetSize: preview.targetSize.cards,
    exactSize: preview.targetSize.exact,
    beforeAverageManaValue: roundToHundredths(before.stats.averageManaValue),
    afterAverageManaValue: roundToHundredths(after.stats.averageManaValue),
    roles: preview.roles
      .filter((role) => role.before > 0 || role.after > 0 || role.target !== null)
      .map((role) => ({
        tag: role.tag,
        label: TAG_LABELS[role.tag],
        before: role.before,
        after: role.after,
        target: role.target,
      })),
    problemsAdded: problems.added.map(problemText),
    problemsResolved: problems.resolved.map(problemText),
    problemsRemainingCount: problems.remaining.length,
    bracketBefore: bracket.before === null ? null : estimateLabel(bracket.before),
    bracketAfter: bracket.after === null ? null : estimateLabel(bracket.after),
    bracketWarningAfter:
      bracket.warningAfter === null ? null : bracketWarningText(bracket.warningAfter),
    changes: preview.changes.map((change) => ({
      name: change.name,
      board: change.board,
      before: change.beforeQuantity,
      after: change.afterQuantity,
    })),
  };
}
