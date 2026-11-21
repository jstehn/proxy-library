import {
  type Board,
  type DeckFacts,
  type DeckOverview,
  type DeckSignals,
  type ManaBasePlanWithCastability,
} from "@/modules/decks";
import {
  bracketWarningText,
  estimateLabel,
  findingWithCards,
  uncheckedText,
} from "@/app/decks/labels";

// What get_deck says (design doc 61, section 5a); these functions only reshape what the
// capabilities answered, and never query.

/** The public get_deck input, as the shaping needs it. */
export type PresentInput = Readonly<{
  view: "compact" | "full";
  includeText: boolean;
  include: readonly string[];
  cards?: readonly string[];
  boards?: readonly Board[];
  cursor?: number;
}>;

/** What the get_deck binding's call collected. */
export type GetDeckAnswer = Readonly<{
  overview: DeckOverview;
  facts?: DeckFacts;
  signals?: DeckSignals;
  manaPlan?: ManaBasePlanWithCastability;
}>;

/** The bracket as get_deck reports it (design doc 31). Null outside Commander. */
export function bracketView(report: DeckOverview["bracket"]) {
  if (report === null) return null;
  const { estimate, warning, reasons, target } = report;
  return {
    target,
    floor: estimate.floor,
    range: estimate.range,
    summary: `${estimateLabel(estimate)} (at least, from the cards)`,
    gameChangers: estimate.gameChangers,
    findings: estimate.findings.map((finding, idx) => ({
      rule: finding.rule,
      count: finding.count,
      forces: finding.forces,
      threshold: reasons[idx]?.threshold,
      cards: finding.cards,
      text: findingWithCards(finding),
    })),
    overTarget: warning === null ? null : bracketWarningText(warning),
    unchecked: uncheckedText(estimate.unchecked),
  };
}
