// Commander brackets (design doc 31, sections 3.2 and 3.3): the lowest bracket a deck's cards
// allow, why, and whether it's within the bracket its owner chose. Pure, and safe for the browser.
import { BRACKET_FLAGS, bracketFlags, type BracketFlag } from "@/shared/card-search";
import { isPlayed, type Board } from "./boards";
import type { Format } from "./deck";

export const BRACKETS = [1, 2, 3, 4, 5] as const;
/** Wizards' Commander power bands: 1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH. */
export type Bracket = (typeof BRACKETS)[number];

export const BRACKET_NAMES: Readonly<Record<Bracket, string>> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

export function isBracket(value: number): value is Bracket {
  return (BRACKETS as readonly number[]).includes(value);
}

/** What the estimate reads from a deck line. */
export type BracketLine = Readonly<{
  name: string;
  quantity: number;
  board: Board;
  flags: readonly BracketFlag[];
}>;

/** What a deck line needs for its bracket flags: the card's text and Scryfall's flag. */
export type BracketSource = Readonly<{
  name: string;
  quantity: number;
  board: Board;
  typeLine: string;
  text: string;
  isGameChanger: boolean;
}>;

/** A deck line as the estimate reads it, with its flags worked out by the one rule table. */
export function bracketLine(line: BracketSource): BracketLine {
  return { name: line.name, quantity: line.quantity, board: line.board, flags: bracketFlags(line) };
}

export const BRACKET_FLAG_RULE_NAMES = ["gameChangers", "landDenial", "extraTurns"] as const;
export type BracketFlagRule = (typeof BRACKET_FLAG_RULE_NAMES)[number];

export const BRACKET_RULE_NAMES = [
  "gameChangers",
  "landDenial",
  "extraTurns",
  "twoCardCombos",
] as const;
export type BracketRule = (typeof BRACKET_RULE_NAMES)[number];

/** A two-card combo present in the deck (from Commander Spellbook). */
export type DeckCombo = Readonly<{
  id: string;
  cards: readonly [string, string];
  produces: readonly string[];
  forces: Bracket;
}>;

/** One reason for the floor: a rule, the cards that trip it, and the bracket it forces. */
export type BracketFinding = Readonly<{
  rule: BracketRule;
  /** Card names, for the panel and for highlighting. */
  cards: readonly string[];
  /** How many copies trip it. */
  count: number;
  /** The lowest bracket this finding allows. */
  forces: Bracket;
}>;

export type BracketRange = Readonly<{ low: Bracket; high: Bracket }>;

export type BracketEstimate = Readonly<{
  /** The highest bracket any finding forces, or 1 with none. Never 5 (cEDH is intent). */
  floor: Bracket;
  /** What the deck could be, given how it's played: floor 1 → 1–2, floor 4 → 4–5. */
  range: BracketRange;
  findings: readonly BracketFinding[];
  gameChangers: number;
  /** What the estimate can't see. */
  unchecked: readonly ("intent" | "combos")[];
}>;

/**
 * The rules, as of Wizards' 9 February 2026 update (tutors stopped counting in October 2025).
 * Each rule maps a number of copies to the lowest bracket it allows; 0 copies never forces one.
 */
export const BRACKET_RULES: Readonly<
  Record<BracketFlagRule, Readonly<{ flag: BracketFlag; forces: (count: number) => Bracket }>>
> = {
  // None in 1–2, up to three in 3, any in 4–5.
  gameChangers: { flag: "gameChanger", forces: (count) => (count <= 3 ? 3 : 4) },
  // Mass land denial: only in 4–5.
  landDenial: { flag: "landDenial", forces: () => 4 },
  // "Few, never chained" in 1–2; chaining is banned in 3, and three or more cards count as
  // chaining (design doc 31, decision 4), so those decks are at least 4.
  extraTurns: { flag: "extraTurn", forces: (count) => (count <= 2 ? 2 : 4) },
};

function rangeFor(floor: Bracket): BracketRange {
  if (floor === 1) return { low: 1, high: 2 };
  if (floor === 4) return { low: 4, high: 5 };
  return { low: floor, high: floor };
}

/** The bracket estimate for a Commander deck, or null for any other format. */
export function estimateBracket(
  format: Format,
  lines: readonly BracketLine[],
  options?: Readonly<{ combos?: readonly DeckCombo[] }>,
): BracketEstimate | null {
  if (format !== "commander") return null;
  const counted = lines.filter((line) => isPlayed(line.board));
  const findings: BracketFinding[] = [];
  for (const rule of BRACKET_FLAG_RULE_NAMES) {
    const { flag, forces } = BRACKET_RULES[rule];
    const tripping = counted.filter((line) => line.flags.includes(flag));
    const count = tripping.reduce((total, line) => total + line.quantity, 0);
    if (count === 0) continue;
    findings.push({ rule, cards: tripping.map((line) => line.name), count, forces: forces(count) });
  }
  const combos = options?.combos;
  if (combos !== undefined) {
    for (const combo of combos) {
      findings.push({
        rule: "twoCardCombos",
        cards: combo.cards,
        count: 1,
        forces: combo.forces,
      });
    }
  }
  const floor = findings.reduce<Bracket>(
    (highest, finding) => (finding.forces > highest ? finding.forces : highest),
    1,
  );
  const gameChangers = findings.find((finding) => finding.rule === "gameChangers")?.count ?? 0;
  const unchecked: readonly ("intent" | "combos")[] =
    combos !== undefined ? ["intent"] : ["intent", "combos"];
  return { floor, range: rangeFor(floor), findings, gameChangers, unchecked };
}

/** The cards go over the bracket the owner chose. A warning, never a deck problem. */
export type BracketWarning = Readonly<{
  kind: "OverTargetBracket";
  target: Bracket;
  floor: Bracket;
  /** Only the findings that force a bracket above the target. */
  findings: readonly BracketFinding[];
}>;

/** null when there's no target or estimate, or the floor is within the target. */
export function bracketWarning(
  estimate: BracketEstimate | null,
  target: Bracket | null,
): BracketWarning | null {
  if (estimate === null || target === null || estimate.floor <= target) return null;
  return {
    kind: "OverTargetBracket",
    target,
    floor: estimate.floor,
    findings: estimate.findings.filter((finding) => finding.forces > target),
  };
}

/**
 * Whether one more copy of a card keeps the deck within the target, judged only on the rules the
 * card itself trips: every rule it adds to must still allow the target. A card isn't blamed for
 * what's already over (a Game Changer too many doesn't stop an extra-turn card fitting bracket 2).
 * Suggestions use it to leave cards out.
 */
export function fitsTarget(
  lines: readonly BracketLine[],
  card: Readonly<{ name: string; flags: readonly BracketFlag[] }>,
  target: Bracket,
): boolean {
  const counted = lines.filter((line) => isPlayed(line.board));
  return BRACKET_FLAG_RULE_NAMES.every((rule) => {
    const { flag, forces } = BRACKET_RULES[rule];
    if (!card.flags.includes(flag)) return true;
    const already = counted
      .filter((line) => line.flags.includes(flag))
      .reduce((total, line) => total + line.quantity, 0);
    return forces(already + 1) <= target;
  });
}

/**
 * The flags a card can't have and still keep the deck within its target. fitsTarget judges each
 * rule on its own, so a card fits exactly when each of its flags fits alone: searches turn this
 * into SQL.
 */
export function flagsOverTarget(lines: readonly BracketLine[], target: Bracket): BracketFlag[] {
  return BRACKET_FLAGS.filter((flag) => !fitsTarget(lines, { name: flag, flags: [flag] }, target));
}

/** Human-readable explanation for one triggered Commander bracket rule. */
export type BracketRuleReason = Readonly<{
  rule: BracketRule;
  bracketFloor: Bracket;
  count: number;
  threshold: string;
  cards: readonly string[];
  summary: string;
}>;

function thresholdForFinding(finding: BracketFinding): string {
  switch (finding.rule) {
    case "gameChangers":
      return finding.count <= 3
        ? "1–3 Game Changers allows Bracket 3 (0 for 1–2; 4+ forces 4)"
        : "4+ Game Changers forces Bracket 4";
    case "landDenial":
      return "Any mass land denial forces Bracket 4";
    case "extraTurns":
      return finding.count <= 2
        ? "1–2 extra-turn spells allows Bracket 2 (3+ forces 4)"
        : "3+ extra-turn spells forces Bracket 4";
    case "twoCardCombos":
      return `Two-card combo forces Bracket ${finding.forces}`;
  }
}

/** Formats bracket findings with the exact rule thresholds and card names. */
export function bracketRuleReasons(findings: readonly BracketFinding[]): BracketRuleReason[] {
  return findings.map((finding) => {
    const threshold = thresholdForFinding(finding);
    return {
      rule: finding.rule,
      bracketFloor: finding.forces,
      count: finding.count,
      threshold,
      cards: finding.cards,
      summary: `${threshold}: ${finding.cards.join(", ")}`,
    };
  });
}
