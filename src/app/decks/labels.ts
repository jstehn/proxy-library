import type {
  Bracket,
  BracketEstimate,
  BracketFinding,
  BracketWarning,
  DeckProblem,
  Format,
  Reason,
} from "@/modules/decks";
import { BRACKET_NAMES, plural } from "@/modules/decks/client";
import { THEME_LABELS, type Tag } from "@/shared/card-search";
import { assertNever } from "@/shared/kernel";

export const FORMAT_LABELS: Record<Format, string> = {
  casual: "Casual (no rules)",
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
  commander: "Commander",
  limited: "Limited (40 cards)",
};

/** A format's label from text that might not be a format (an old feed event, say). */
export function formatLabel(format: string): string {
  const labels: Readonly<Record<string, string | undefined>> = FORMAT_LABELS;
  return labels[format] ?? format;
}

/** A deck problem in plain words. */
export function problemText(problem: DeckProblem): string {
  switch (problem.kind) {
    case "Short":
      return `You own ${problem.owned} ${problem.name}, and the deck uses ${problem.needed}.`;
    case "TooFewCards":
      return `The main deck has ${problem.count} cards; it needs at least ${problem.minimum}.`;
    case "WrongSize":
      return `The deck has ${problem.count} cards; it needs exactly ${problem.required}.`;
    case "SideboardTooBig":
      return `The sideboard has ${problem.count} cards; the most is ${problem.maximum}.`;
    case "TooManyCopies":
      return `${problem.count} copies of ${problem.name}; the most allowed is ${problem.maximum}.`;
    case "NotLegal":
      return `${problem.name} is ${problem.status.replace("_", " ")} in this format.`;
    case "CommanderMissing":
      return "Choose a commander (put a card on the commander board).";
    case "TooManyCommanders":
      return `${problem.count} commanders; the most is 2.`;
    case "CommanderInvalid":
      return `${problem.name} can't be a commander (a commander is a legendary creature, a legendary Vehicle or Spacecraft with power and toughness, or says it can be your commander).`;
    case "OutsideColorIdentity":
      return `${problem.name} is outside your commander's colors.`;
    default:
      return assertNever(problem);
  }
}

/** "Bracket 3 · Upgraded" (design doc 31). */
export function bracketLabel(bracket: Bracket): string {
  return `Bracket ${bracket} · ${BRACKET_NAMES[bracket]}`;
}

/** The estimate's headline: "Bracket 1–2", "Bracket 3 · Upgraded", "Bracket 4–5". */
export function estimateLabel(estimate: BracketEstimate): string {
  const { low, high } = estimate.range;
  return low === high ? bracketLabel(low) : `Bracket ${low}–${high}`;
}

const copies = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One reason for the bracket, in words, without the card names (the panel lists those). */
export function findingText(finding: BracketFinding): string {
  switch (finding.rule) {
    case "gameChangers":
      return finding.forces === 3
        ? `${copies(finding.count, "Game Changer", "Game Changers")} (up to 3 in bracket 3)`
        : `${finding.count} Game Changers (more than 3: bracket 4)`;
    case "landDenial":
      return `${copies(finding.count, "mass land denial card", "mass land denial cards")} (bracket 4)`;
    case "extraTurns":
      return finding.forces === 2
        ? `${copies(finding.count, "extra-turn card", "extra-turn cards")} (a few are fine in bracket 2)`
        : `${finding.count} extra-turn cards (3 or more is chaining: bracket 4)`;
    default:
      return assertNever(finding.rule);
  }
}

/** A finding with its cards: "2 Game Changers (up to 3 in bracket 3): Rhystic Study, …". */
export function findingWithCards(finding: BracketFinding): string {
  return `${findingText(finding)}: ${finding.cards.join(", ")}`;
}

/** The over-target warning in words. */
export function bracketWarningText(warning: BracketWarning): string {
  return `The cards make this at least bracket ${warning.floor}, over your target of ${warning.target}: ${warning.findings.map(findingWithCards).join("; ")}.`;
}

/** What the estimate can't check, in words. */
export const UNCHECKED_TEXT = "Not checked: two-card combos, and how you play the deck.";

/** Role tags as the builder names them (design doc 19). */
export const TAG_LABELS: Record<Tag, string> = {
  ramp: "Ramp",
  draw: "Card draw",
  removal: "Removal",
  wipe: "Board wipes",
  counter: "Counterspells",
  tutor: "Tutors",
  protection: "Protection",
};

/** Why a card is suggested, in words (design doc 20). */
export function reasonText(reason: Reason): string {
  switch (reason.kind) {
    case "theme":
      return THEME_LABELS[reason.theme];
    case "tribe":
      return plural(reason.tribe);
    case "role":
      return reason.count === undefined || reason.target === undefined
        ? TAG_LABELS[reason.tag]
        : `${TAG_LABELS[reason.tag]} (${reason.count} of ${reason.target})`;
    case "keyword":
      return reason.keyword;
    default:
      return assertNever(reason);
  }
}
