import { TAGS, type Tag } from "@/shared/card-search";
import { assertNever } from "@/shared/kernel";
import {
  bracketLine,
  bracketWarning,
  estimateBracket,
  type Bracket,
  type BracketEstimate,
  type BracketSource,
  type BracketWarning,
} from "./brackets";
import type { Board, Format } from "./deck";
import { deckProblems, shortCount, type CardRules, type DeckProblem } from "./rules";
import {
  deckSize,
  deckStats,
  roleTargets,
  TARGETED_TAGS,
  type DeckStats,
  type StatsLine,
  type TargetedTag,
} from "./stats";

// Dry-run deck preview (design doc 40, section 3): computes before/after stats, roles, problems,
// bracket and price for a batch of quantity changes without touching the database.

export type DeckChange = Readonly<{
  oracleId: string;
  board: Board;
  /** Sets the card's count on this board; 0 removes it. */
  quantity: number;
}>;

/** Everything a preview needs from one deck line (matches `DeckLine` + `CardRules`). */
export type PreviewLine = StatsLine &
  BracketSource &
  Readonly<{
    oracleId: string;
    name: string;
    owned: number;
    rules: CardRules;
  }>;

export type AppliedChange = Readonly<{
  oracleId: string;
  name: string;
  board: Board;
  beforeQuantity: number;
  afterQuantity: number;
}>;

export type RoleDelta = Readonly<{
  tag: Tag;
  before: number;
  after: number;
  target: number | null;
}>;

export type PreviewSnapshot = Readonly<{
  stats: DeckStats;
  problems: readonly DeckProblem[];
  bracket: BracketEstimate | null;
  shortTotal: number;
}>;

export type ChangePreview = Readonly<{
  format: Format;
  targetSize: Readonly<{ cards: number; exact: boolean }>;
  targetBracket: Bracket | null;
  before: PreviewSnapshot;
  after: PreviewSnapshot;
  changes: readonly AppliedChange[];
  problems: Readonly<{
    added: readonly DeckProblem[];
    resolved: readonly DeckProblem[];
    remaining: readonly DeckProblem[];
  }>;
  roles: readonly RoleDelta[];
  newlyMetRoles: readonly TargetedTag[];
  newlyMissedRoles: readonly TargetedTag[];
  bracket: Readonly<{
    before: BracketEstimate | null;
    after: BracketEstimate | null;
    warningAfter: BracketWarning | null;
  }>;
  priceDeltaCents: number;
  newlyShort: readonly Extract<DeckProblem, { kind: "Short" }>[];
}>;

/** Stable key matching `problemText` 1-to-1, so count shifts read as resolved + added. */
export function problemKey(problem: DeckProblem): string {
  switch (problem.kind) {
    case "Short":
      return `Short:${problem.oracleId}:${problem.needed}:${problem.owned}`;
    case "TooFewCards":
      return `TooFewCards:${problem.minimum}:${problem.count}`;
    case "WrongSize":
      return `WrongSize:${problem.required}:${problem.count}`;
    case "SideboardTooBig":
      return `SideboardTooBig:${problem.maximum}:${problem.count}`;
    case "TooManyCopies":
      return `TooManyCopies:${problem.name}:${problem.maximum}:${problem.count}`;
    case "NotLegal":
      return `NotLegal:${problem.name}:${problem.status}`;
    case "CommanderMissing":
      return "CommanderMissing";
    case "TooManyCommanders":
      return `TooManyCommanders:${problem.count}`;
    case "CommanderInvalid":
      return `CommanderInvalid:${problem.name}`;
    case "CommandersCantPair":
      return `CommandersCantPair:${problem.names[0]}:${problem.names[1]}`;
    case "OutsideColorIdentity":
      return `OutsideColorIdentity:${problem.name}`;
    default:
      return assertNever(problem);
  }
}

function snapshotOf(
  format: Format,
  lines: readonly PreviewLine[],
  rulesLookup: (oracleId: string) => CardRules,
  ownedLookup: (oracleId: string) => number,
): PreviewSnapshot {
  const entries = lines.map((line) => ({
    oracleId: line.oracleId,
    board: line.board,
    quantity: line.quantity,
    printingId: null,
    finish: null,
    heading: null,
  }));
  const problems = deckProblems({ format, entries }, rulesLookup, ownedLookup);
  return {
    stats: deckStats(lines),
    problems,
    bracket: estimateBracket(format, lines.map(bracketLine)),
    shortTotal: shortCount(problems),
  };
}

/**
 * Pure dry-run of `changes` applied in order to `before` (design doc 40, section 3.2).
 * Uses `withEntry` semantics: each change sets the count on `(oracleId, board)`, 0 removes it,
 * and a later change to the same card and board wins.
 */
export function previewChanges(input: {
  format: Format;
  targetBracket: Bracket | null;
  before: readonly PreviewLine[];
  changes: readonly DeckChange[];
  facts: (oracleId: string) => PreviewLine;
}): ChangePreview {
  const known = new Map<string, PreviewLine>();
  for (const line of input.before) {
    if (!known.has(line.oracleId)) known.set(line.oracleId, line);
  }
  const templateOf = (oracleId: string): PreviewLine => {
    const existing = known.get(oracleId);
    if (existing !== undefined) return existing;
    const loaded = input.facts(oracleId);
    known.set(oracleId, loaded);
    return loaded;
  };

  const working: PreviewLine[] = [...input.before];
  const lineKey = (oracleId: string, board: Board) => `${board}:${oracleId}`;
  const beforeQuantity = new Map<string, number>();
  for (const line of input.before) {
    beforeQuantity.set(lineKey(line.oracleId, line.board), line.quantity);
  }

  const touched = new Map<string, { oracleId: string; board: Board }>();
  for (const change of input.changes) {
    const key = lineKey(change.oracleId, change.board);
    if (!touched.has(key)) touched.set(key, { oracleId: change.oracleId, board: change.board });
    const index = working.findIndex(
      (entry) => entry.oracleId === change.oracleId && entry.board === change.board,
    );
    if (change.quantity === 0) {
      if (index !== -1) working.splice(index, 1);
      continue;
    }
    const base = index === -1 ? templateOf(change.oracleId) : working[index];
    const nextLine: PreviewLine = {
      ...base,
      board: change.board,
      quantity: change.quantity,
    };
    if (index === -1) working.push(nextLine);
    else working[index] = nextLine;
  }

  const rulesByCard = new Map<string, CardRules>();
  const ownedByCard = new Map<string, number>();
  for (const line of [...input.before, ...working]) {
    rulesByCard.set(line.oracleId, line.rules);
    ownedByCard.set(line.oracleId, line.owned);
  }
  const rulesLookup = (oracleId: string) => {
    const found = rulesByCard.get(oracleId);
    if (found === undefined) throw new Error(`missing rules for ${oracleId}`);
    return found;
  };
  const ownedLookup = (oracleId: string) => ownedByCard.get(oracleId) ?? 0;

  const before = snapshotOf(input.format, input.before, rulesLookup, ownedLookup);
  const after = snapshotOf(input.format, working, rulesLookup, ownedLookup);

  const changes: AppliedChange[] = [...touched.entries()].map(([key, { oracleId, board }]) => {
    const afterLine = working.find((entry) => entry.oracleId === oracleId && entry.board === board);
    return {
      oracleId,
      name: (afterLine ?? templateOf(oracleId)).name,
      board,
      beforeQuantity: beforeQuantity.get(key) ?? 0,
      afterQuantity: afterLine?.quantity ?? 0,
    };
  });

  const beforeKeys = new Set(before.problems.map(problemKey));
  const afterKeys = new Set(after.problems.map(problemKey));
  const added = after.problems.filter((problem) => !beforeKeys.has(problemKey(problem)));
  const resolved = before.problems.filter((problem) => !afterKeys.has(problemKey(problem)));
  const remaining = after.problems.filter((problem) => beforeKeys.has(problemKey(problem)));

  const targets = roleTargets(input.format);
  const roles: RoleDelta[] = TAGS.map((tag) => ({
    tag,
    before: before.stats.tags[tag],
    after: after.stats.tags[tag],
    target: targets !== null && tag in targets ? targets[tag as TargetedTag] : null,
  }));
  const newlyMetRoles =
    targets === null
      ? []
      : TARGETED_TAGS.filter(
          (tag) => before.stats.tags[tag] < targets[tag] && after.stats.tags[tag] >= targets[tag],
        );
  const newlyMissedRoles =
    targets === null
      ? []
      : TARGETED_TAGS.filter(
          (tag) => before.stats.tags[tag] >= targets[tag] && after.stats.tags[tag] < targets[tag],
        );

  const beforeShort = new Map<string, number>();
  for (const problem of before.problems) {
    if (problem.kind === "Short") {
      beforeShort.set(problem.oracleId, problem.needed - problem.owned);
    }
  }
  const newlyShort = after.problems.filter(
    (problem): problem is Extract<DeckProblem, { kind: "Short" }> =>
      problem.kind === "Short" &&
      problem.needed - problem.owned > (beforeShort.get(problem.oracleId) ?? 0),
  );

  return {
    format: input.format,
    targetSize: deckSize(input.format),
    targetBracket: input.targetBracket,
    before,
    after,
    changes,
    problems: { added, resolved, remaining },
    roles,
    newlyMetRoles,
    newlyMissedRoles,
    bracket: {
      before: before.bracket,
      after: after.bracket,
      warningAfter: bracketWarning(after.bracket, input.targetBracket),
    },
    priceDeltaCents: after.stats.priceCents - before.stats.priceCents,
    newlyShort,
  };
}
