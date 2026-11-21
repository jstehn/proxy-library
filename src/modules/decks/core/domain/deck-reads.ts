import type { Format } from "./deck";
import type { DeckLine, DeckView } from "./deck-view";
import {
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  estimateBracket,
  type Bracket,
  type BracketEstimate,
  type BracketRuleReason,
  type BracketWarning,
  type DeckCombo,
} from "./brackets";
import { deckText, fingerprint } from "./list-format";
import { deckProblems, type CardRules, type DeckProblem } from "./rules";

// The facts about a deck that every reader needs the same way (design doc 65, audit F2): its
// problems, its Commander bracket, and its list text with the fingerprint of what's stored. The
// builder, the deck page and the LLM tools all take these from here.

/**
 * Everything wrong with the deck made of `lines`. A line whose rules haven't arrived can't be
 * checked yet, so it's left out (the builder shows a card before the server has answered).
 */
export function problemsOfLines(
  format: Format,
  lines: readonly DeckLine[],
  rules: Readonly<Record<string, CardRules>>,
): DeckProblem[] {
  const checkable = lines.filter((line) => rules[line.oracleId] !== undefined);
  const owned = new Map(checkable.map((line) => [line.oracleId, line.owned]));
  return deckProblems(
    {
      format,
      entries: checkable.map((line) => ({
        oracleId: line.oracleId,
        board: line.board,
        quantity: line.quantity,
        printingId: null,
        finish: null,
        heading: null,
        note: null,
      })),
    },
    (oracleId) => rules[oracleId],
    (oracleId) => owned.get(oracleId) ?? 0,
  );
}

export type BracketReport = Readonly<{
  target: Bracket | null;
  estimate: BracketEstimate;
  /** Set when the deck's floor is above its target. */
  warning: BracketWarning | null;
  /** One entry per `estimate.findings`, with the threshold that triggered it. */
  reasons: readonly BracketRuleReason[];
}>;

/** The Commander bracket estimate and what it says about the target; null outside Commander. */
export function bracketReport(view: DeckView, combos?: readonly DeckCombo[]): BracketReport | null {
  const estimate = estimateBracket(view.deck.format, view.lines.map(bracketLine), { combos });
  if (estimate === null) return null;
  return {
    target: view.deck.targetBracket,
    estimate,
    warning: bracketWarning(estimate, view.deck.targetBracket),
    reasons: bracketRuleReasons(estimate.findings),
  };
}

/** The deck as its list text and the fingerprint of what's stored (for editing it as text). */
export function listAndFingerprint(view: DeckView): { list: string; fingerprint: string } {
  const list = deckText(
    view.lines.map((line) => ({
      quantity: line.quantity,
      name: line.name,
      board: line.board,
      setCode: line.pinnedPrintingId === null ? null : line.setCode,
      collectorNumber: line.pinnedPrintingId === null ? null : line.collectorNumber,
      finish: line.pinnedFinish,
      heading: line.heading,
    })),
    // Grouped by its own headings, the list shows them as "Ramp (9)" blocks (design doc 34).
    view.deck.grouping === "custom" ? view.deck.headings : null,
  );
  const print = fingerprint(
    view.lines.map((line) => ({
      ...line,
      printingId: line.pinnedPrintingId,
      finish: line.pinnedFinish,
    })),
  );
  return { list, fingerprint: print };
}
