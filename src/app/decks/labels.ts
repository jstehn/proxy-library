import type {
  Bracket,
  CommanderPlan,
  BracketEstimate,
  BracketFinding,
  BracketWarning,
  DeckProblem,
  CutReason,
  DraftReason,
  Format,
  LandReason,
  LandTargetReason,
  Reason,
  SwapReason,
} from "@/modules/decks";
import { BRACKET_NAMES, plural } from "@/modules/decks/client";
import { THEME_LABELS, type BracketFlag, type Tag } from "@/shared/card-search";
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
    case "CommandersCantPair":
      return `${problem.names[0]} and ${problem.names[1]} can't share the command zone: two commanders need Partner, Partner with each other, Friends forever, a Background with Choose a Background, or a Doctor with Doctor's companion.`;
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
    case "twoCardCombos":
      return finding.forces >= 4
        ? `Two-card combo (early-game: bracket ${finding.forces})`
        : "Two-card combo (late-game only: bracket 3)";
    default:
      return assertNever(finding.rule);
  }
}

/** A finding with its cards: "2 Game Changers (up to 3 in bracket 3): Rhystic Study, …". */
export function findingWithCards(finding: BracketFinding): string {
  return finding.rule === "twoCardCombos"
    ? `${findingText(finding)}: ${finding.cards.join(" + ")}`
    : `${findingText(finding)}: ${finding.cards.join(", ")}`;
}

/** The over-target warning in words. */
export function bracketWarningText(warning: BracketWarning): string {
  return `The cards make this at least bracket ${warning.floor}, over your target of ${warning.target}: ${warning.findings.map(findingWithCards).join("; ")}.`;
}

/** What the estimate can't check, in words. */
export const UNCHECKED_TEXT = "Not checked: two-card combos, and how you play the deck.";

export function uncheckedText(unchecked: readonly ("intent" | "combos")[]): string {
  return unchecked.includes("combos") ? UNCHECKED_TEXT : "Not checked: how you play the deck.";
}

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

function edhrecReasonText(inclusionPct: number, synergyPct: number): string {
  const sign = synergyPct >= 0 ? "+" : "";
  return `EDHREC: ${inclusionPct}% of decks (${sign}${synergyPct}% synergy)`;
}

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
    case "edhrec":
      return edhrecReasonText(reason.inclusionPct, reason.synergyPct);
    case "synergy":
      return reason.label;
    case "combo":
      return `Combos with ${reason.partners.slice(0, 2).join(", ")}`;
    case "embedSim":
      return `Reads like deck (${reason.similarityPct}% sim)`;
    default:
      return assertNever(reason);
  }
}

/** Bracket flags in words, for a cut's reason. */
const FLAG_WORDS: Readonly<Record<BracketFlag, string>> = {
  gameChanger: "a Game Changer",
  landDenial: "mass land denial",
  extraTurn: "an extra turn",
};

/** Why a card scores low (or high) on the cut checks, in words (design doc 32). Hints, not verdicts. */
export function cutReasonText(reason: CutReason): string {
  switch (reason.kind) {
    case "noFit":
      return "Matches none of the themes the app found";
    case "fits":
      return `Fits: ${reason.reasons.map(reasonText).join(", ")}`;
    case "surplusRole":
      return `${TAG_LABELS[reason.tag]}: ${reason.count} in the deck, target ${reason.target}`;
    case "neededRole":
      return `${TAG_LABELS[reason.tag]}: ${reason.count} in the deck, target ${reason.target} (short)`;
    case "topHeavy":
      return `${reason.manaValue} mana, and the curve averages ${reason.average}`;
    case "overBracket":
      return `${reason.flags.map((flag) => FLAG_WORDS[flag]).join(", ")}: over your bracket ${reason.target} target`;
    case "notOwned":
      return `You're short ${reason.short}`;
    case "edhrec":
      return edhrecReasonText(reason.inclusionPct, reason.synergyPct);
    case "embedSim":
      return `Reads like deck (${reason.similarityPct}% sim)`;
    default:
      return assertNever(reason);
  }
}

/** Why a one-step swap is suggested, in words (design doc 47). */
export function swapReasonText(reason: SwapReason): string {
  switch (reason.kind) {
    case "ratingGain":
      return `Rating ${reason.cutRating} → ${reason.addRating}`;
    case "fillsRole":
      return `Fills ${TAG_LABELS[reason.tag]}`;
    case "preservesRole":
      return `Preserves ${TAG_LABELS[reason.tag]}`;
    case "similarEffect":
      return `Similar effect (${reason.similarityPct}% match)`;
    case "fixesOverBracket":
      return `Fixes bracket ${reason.target} limit`;
    case "fixesNotOwned":
      return "Replaces an unowned card";
    case "lowersCurve":
      return `Lowers curve (${reason.cutMv} → ${reason.addMv} MV)`;
    default:
      return assertNever(reason);
  }
}

const COLOR_NAMES: Readonly<Record<string, string>> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
};

/** "white and blue" from ["W", "U"]. */
function colorList(colors: readonly string[]): string {
  const names = colors.map((color) => COLOR_NAMES[color] ?? color);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Why the land target moved, in words (design doc 35). */
export function landTargetReasonText(reason: LandTargetReason): string {
  switch (reason.kind) {
    case "base":
      return `${reason.lands} is the usual count`;
    case "lowCurve":
      return `${reason.change}: a low curve (average ${reason.averageManaValue.toFixed(1)})`;
    case "highCurve":
      return `+${reason.change}: a high curve (average ${reason.averageManaValue.toFixed(1)})`;
    case "manyManaSources":
      return `${reason.change}: ${reason.sources} other mana sources`;
    default:
      return assertNever(reason);
  }
}

/** Why a land is in the plan, in words (design doc 35). */
export function landReasonText(reason: LandReason): string {
  switch (reason.kind) {
    case "fixes":
      return `makes ${colorList(reason.colors)}, which the deck is short of`;
    case "untapped":
      return "enters untapped";
    case "utility":
      return `also ${[
        ...reason.roles.map((role) => TAG_LABELS[role].toLowerCase()),
        ...reason.themes.map((theme) => THEME_LABELS[theme].toLowerCase()),
      ].join(", ")}`;
    case "basic":
      return `a basic for ${COLOR_NAMES[reason.color]} sources`;
    default:
      return assertNever(reason);
  }
}

/** What a commander's text leads, in words (design doc 36): "Tokens, Rabbits, Flying". */
export function planText(plan: CommanderPlan): string {
  return [
    ...plan.themes.map((theme) => THEME_LABELS[theme]),
    ...plan.tribes.map(plural),
    ...plan.keywords,
  ].join(", ");
}

/** Why a spell is in a draft, in words (design doc 37). */
export function draftReasonText(reason: DraftReason): string {
  if (reason.kind === "curve") {
    return reason.bucket === "5+" ? "5+ mana curve slot" : `${reason.bucket} mana curve slot`;
  }
  return reasonText(reason);
}
