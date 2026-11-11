import type { Tag, Theme } from "@/shared/card-search";
import type { Format } from "./deck";
import {
  colorPips,
  deckStats,
  MANA_COLORS,
  suggestedLands,
  type DeckStats,
  type ManaColor,
} from "./stats";
import type { ProfileLine } from "./suggest";

// A mana base you could start from (design doc 35): how many lands, how many sources of each
// color, and which lands to add, owned non-basics first, then basics. Pure: the query gathers
// the candidates, this picks them and says why. Like suggestions, these are ideas to weigh.

/** A land the plan may add: one you own, a basic, or one from the store. */
export type LandCandidate = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  /** Rules text of every face, for "enters tapped". */
  text: string;
  /** Colors it can make: "W", "U", "B", "R", "G", "C". */
  producedMana: readonly string[];
  isBasicLand: boolean;
  /** Copies you own. Decks share cards, so other decks using it don't lower this. */
  ownedCopies: number;
  /** Your other decks that play it too: a note for the player, never a limit. */
  alsoIn: readonly string[];
  /** Store price of one copy, in cents (store candidates only). */
  priceCents: number | null;
  roles: readonly Tag[];
  themes: readonly Theme[];
}>;

/** Whether a land enters the battlefield tapped: always, only sometimes ("unless …"), or never. */
export type Tapped = "never" | "sometimes" | "always";

/** Why the land target moved away from the format's usual count. */
export type LandTargetReason =
  | Readonly<{ kind: "base"; lands: number }>
  | Readonly<{ kind: "lowCurve"; averageManaValue: number; change: number }>
  | Readonly<{ kind: "highCurve"; averageManaValue: number; change: number }>
  | Readonly<{ kind: "manyManaSources"; sources: number; change: number }>;

export type LandTarget = Readonly<{ lands: number; reasons: readonly LandTargetReason[] }>;

/** How many sources of one color the deck aims for, and has. */
export type SourceTarget = Readonly<{
  color: ManaColor;
  target: number;
  have: number;
  /** The most symbols of this color in one card's cost (3 means three or more). */
  heaviestCost: number;
}>;

/** Why a land was picked. */
export type LandReason =
  | Readonly<{ kind: "fixes"; colors: readonly ManaColor[] }>
  | Readonly<{ kind: "untapped" }>
  | Readonly<{ kind: "utility"; roles: readonly Tag[]; themes: readonly Theme[] }>
  | Readonly<{ kind: "basic"; color: ManaColor | "C" }>;

export type PlannedLand = Readonly<{
  card: LandCandidate;
  quantity: number;
  tapped: Tapped;
  reasons: readonly LandReason[];
}>;

export type ManaBasePlan = Readonly<{
  landTarget: LandTarget;
  /** Lands the deck has now. */
  lands: number;
  /** One per color the deck's spells use. */
  sources: readonly SourceTarget[];
  /** Owned non-basics first, then basics. Empty when the deck is at or over its target. */
  add: readonly PlannedLand[];
  /** Lands over the target. */
  over: number;
  /** Up to five store lands that would help; never in `add`. */
  considerBuying: readonly PlannedLand[];
}>;

export type ManaBaseInput = Readonly<{
  format: Format;
  /** The deck as it is: counted boards are read, the maybeboard isn't. */
  lines: readonly ProfileLine[];
  /** Copies of each card (by oracle id) the deck already plays. */
  inDeck: ReadonlyMap<string, number>;
  /** Lands you own that the deck may play (the query checks identity and bracket). */
  owned: readonly LandCandidate[];
  /** The basic lands, Wastes included, to fill the rest with. */
  basics: readonly LandCandidate[];
  /** Store lands the deck may play. */
  store: readonly LandCandidate[];
  /** Roles the deck is short on and themes it has: a land doing these is a utility land. */
  deckRoles: readonly Tag[];
  deckThemes: readonly Theme[];
}>;

/** How many store lands to show. */
const CONSIDER_BUYING = 5;
/** A non-basic must score more than this to be picked; a basic does as well below it. */
const BASIC_EQUIVALENT = 2;

/** The points a land earns (section 3.3), in one place to tune. */
export const LAND_WEIGHTS = {
  /** A short color it makes: this much, plus up to 1 more the shorter the color is. */
  shortColor: 2,
  /** A deck color it makes that isn't short. */
  otherColor: 1,
  utility: 3,
  alwaysTapped: -2,
  sometimesTapped: -1,
} as const;

/** Sources to aim for in a color, by the most symbols of it in one cost (1, 2, 3 or more). */
const SOURCE_FLOORS: Readonly<Record<"commander" | "other", readonly [number, number, number]>> = {
  commander: [10, 15, 19],
  other: [8, 12, 15],
};

/** The land count to aim for: the format's usual count, moved by the curve and other sources. */
export function landTarget(format: Format, stats: DeckStats): LandTarget {
  const base = suggestedLands(format);
  const reasons: LandTargetReason[] = [{ kind: "base", lands: base }];
  // Limited decks have few rocks and a known curve: the usual 17 stands.
  const spells = stats.curve.reduce((sum, count) => sum + count, 0);
  if (format !== "limited" && spells > 0) {
    const average = stats.averageManaValue;
    if (average < 2.5) reasons.push({ kind: "lowCurve", averageManaValue: average, change: -1 });
    else if (average >= 4) {
      reasons.push({ kind: "highCurve", averageManaValue: average, change: 2 });
    } else if (average >= 3.5) {
      reasons.push({ kind: "highCurve", averageManaValue: average, change: 1 });
    }
    const extraSources = stats.otherManaSources - 9;
    if (extraSources >= 3) {
      reasons.push({
        kind: "manyManaSources",
        sources: stats.otherManaSources,
        change: -Math.min(3, Math.floor(extraSources / 3)),
      });
    }
  }
  const total = reasons.reduce(
    (sum, reason) => sum + (reason.kind === "base" ? reason.lands : reason.change),
    0,
  );
  return { lands: Math.min(base + 3, Math.max(base - 4, total)), reasons };
}

/** Sources to aim for in each color the spells use: a share of the lands, at least a floor. */
export function sourceTargets(
  format: Format,
  lines: readonly ProfileLine[],
  target: LandTarget,
): SourceTarget[] {
  const stats = deckStats(lines);
  const allPips = MANA_COLORS.reduce((sum, color) => sum + stats.pips[color], 0);
  const floors = SOURCE_FLOORS[format === "commander" ? "commander" : "other"];
  const heaviest = heaviestCosts(lines);
  return MANA_COLORS.filter((color) => stats.pips[color] > 0).map((color) => {
    const share = Math.round((target.lands * stats.pips[color]) / allPips);
    const heaviestCost = heaviest[color];
    return {
      color,
      target: Math.max(share, floors[heaviestCost - 1]),
      have: stats.sources[color],
      heaviestCost,
    };
  });
}

/** The most symbols of each color in one played card's cost, capped at 3. */
function heaviestCosts(lines: readonly ProfileLine[]): Record<ManaColor, number> {
  const heaviest: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const line of lines) {
    if (line.board !== "main" && line.board !== "commander") continue;
    const pips = colorPips(line.manaCost);
    for (const color of MANA_COLORS) heaviest[color] = Math.max(heaviest[color], pips[color]);
  }
  for (const color of MANA_COLORS) heaviest[color] = Math.min(3, heaviest[color]);
  return heaviest;
}

const ENTERS_TAPPED = /enters( the battlefield)? tapped/i;

/** Whether a land enters tapped, from its rules text (the search language's patterns). */
export function tapped(text: string): Tapped {
  const sentence = text.split(/(?<=\.)\s+|\n/).find((part) => ENTERS_TAPPED.test(part));
  if (sentence === undefined) return "never";
  return /\bunless\b|\bif\b|you may pay/i.test(sentence) ? "sometimes" : "always";
}

/** The plan's running state while it fills: what each color still needs. */
type Gaps = Map<ManaColor, number>;

type Scored = Readonly<{
  card: LandCandidate;
  score: number;
  tapped: Tapped;
  reasons: LandReason[];
}>;

/** A mana base you could start from: targets, and lands to reach them (section 3.3). */
export function planManaBase(input: ManaBaseInput): ManaBasePlan {
  const stats = deckStats(input.lines);
  const target = landTarget(input.format, stats);
  const sources = sourceTargets(input.format, input.lines, target);
  const gaps: Gaps = new Map(
    sources.map((source) => [source.color, Math.max(0, source.target - source.have)]),
  );
  const deckColors = sources.map((source) => source.color);
  const targets = new Map(sources.map((source) => [source.color, source.target]));
  const needed = Math.max(0, target.lands - stats.lands);

  const picks = pickNonBasics(input, needed, gaps, deckColors, targets);
  const pickedCount = picks.reduce((sum, pick) => sum + pick.quantity, 0);
  const considerBuying = rankStoreLands(input, gaps, deckColors, targets);
  const basics = fillBasics(input, needed - pickedCount, gaps, stats, deckColors);

  return {
    landTarget: target,
    lands: stats.lands,
    sources,
    add: [...picks, ...basics],
    over: Math.max(0, stats.lands - target.lands),
    considerBuying,
  };
}

/** How many copies of a card a deck of this format may hold. */
function copyLimit(format: Format): number {
  return format === "commander" ? 1 : 4;
}

/** A non-basic's score against what the deck still needs, with its reasons. */
function scoreLand(
  card: LandCandidate,
  input: ManaBaseInput,
  gaps: Gaps,
  deckColors: readonly ManaColor[],
  targets: ReadonlyMap<ManaColor, number>,
): Scored {
  let score = 0;
  const reasons: LandReason[] = [];
  const fixes: ManaColor[] = [];
  for (const color of deckColors) {
    if (!card.producedMana.includes(color)) continue;
    const gap = gaps.get(color) ?? 0;
    if (gap > 0) {
      score += LAND_WEIGHTS.shortColor + gap / (targets.get(color) ?? gap);
      fixes.push(color);
    } else {
      score += LAND_WEIGHTS.otherColor;
    }
  }
  // A colorless deck's only color is colorless mana.
  if (deckColors.length === 0 && card.producedMana.includes("C")) score += LAND_WEIGHTS.otherColor;
  if (fixes.length > 0) reasons.push({ kind: "fixes", colors: fixes });

  const roles = card.roles.filter((role) => input.deckRoles.includes(role));
  const themes = card.themes.filter((theme) => input.deckThemes.includes(theme));
  if (roles.length > 0 || themes.length > 0) {
    score += LAND_WEIGHTS.utility;
    reasons.push({ kind: "utility", roles, themes });
  }

  const enters = tapped(card.text);
  // Tapped-ness only matters for a land worth playing at all.
  if (score > 0) {
    if (enters === "always") score += LAND_WEIGHTS.alwaysTapped;
    if (enters === "sometimes") score += LAND_WEIGHTS.sometimesTapped;
  }
  if (enters === "never" && score > 0) reasons.push({ kind: "untapped" });
  return { card, score, tapped: enters, reasons };
}

const TAPPED_ORDER: Readonly<Record<Tapped, number>> = { never: 0, sometimes: 1, always: 2 };

/** Best first: score, then untapped, then name (so the plan is the same every time). */
function byScore(first: Scored, second: Scored): number {
  return (
    second.score - first.score ||
    TAPPED_ORDER[first.tapped] - TAPPED_ORDER[second.tapped] ||
    first.card.name.localeCompare(second.card.name)
  );
}

/** Take the gaps a land closes: one more source of each color it makes. */
function closeGaps(card: LandCandidate, gaps: Gaps): void {
  for (const [color, gap] of gaps) {
    if (card.producedMana.includes(color)) gaps.set(color, Math.max(0, gap - 1));
  }
}

/** Owned non-basics, one at a time, each the best for what the deck still needs. */
function pickNonBasics(
  input: ManaBaseInput,
  needed: number,
  gaps: Gaps,
  deckColors: readonly ManaColor[],
  targets: ReadonlyMap<ManaColor, number>,
): PlannedLand[] {
  const copiesLeft = new Map<string, number>();
  for (const card of input.owned) {
    if (card.isBasicLand) continue;
    const room = copyLimit(input.format) - (input.inDeck.get(card.oracleId) ?? 0);
    copiesLeft.set(card.oracleId, Math.min(card.ownedCopies, room));
  }
  const picked = new Map<string, Scored & { quantity: number }>();
  for (let added = 0; added < needed; added += 1) {
    const best = input.owned
      .filter((card) => (copiesLeft.get(card.oracleId) ?? 0) > 0)
      .map((card) => scoreLand(card, input, gaps, deckColors, targets))
      .sort(byScore)[0];
    if (best === undefined || best.score <= BASIC_EQUIVALENT) break;
    copiesLeft.set(best.card.oracleId, (copiesLeft.get(best.card.oracleId) ?? 0) - 1);
    // The reasons are the first copy's: why it was worth taking at all.
    const earlier = picked.get(best.card.oracleId);
    picked.set(best.card.oracleId, {
      ...(earlier ?? best),
      quantity: (earlier?.quantity ?? 0) + 1,
    });
    closeGaps(best.card, gaps);
  }
  return [...picked.values()].map((pick) => ({
    card: pick.card,
    quantity: pick.quantity,
    tapped: pick.tapped,
    reasons: pick.reasons,
  }));
}

/** Store lands worth considering against the gaps the owned lands left (never added). */
function rankStoreLands(
  input: ManaBaseInput,
  gaps: Gaps,
  deckColors: readonly ManaColor[],
  targets: ReadonlyMap<ManaColor, number>,
): PlannedLand[] {
  const owned = new Set(input.owned.map((card) => card.oracleId));
  return input.store
    .filter((card) => !card.isBasicLand && !owned.has(card.oracleId))
    .filter((card) => !input.inDeck.has(card.oracleId))
    .map((card) => scoreLand(card, input, gaps, deckColors, targets))
    .filter((scored) => scored.score > BASIC_EQUIVALENT)
    .sort(
      (first, second) =>
        second.score - first.score ||
        (first.card.priceCents ?? 0) - (second.card.priceCents ?? 0) ||
        byScore(first, second),
    )
    .slice(0, CONSIDER_BUYING)
    .map((scored) => ({
      card: scored.card,
      quantity: 1,
      tapped: scored.tapped,
      reasons: scored.reasons,
    }));
}

/** The basic that makes a color, or Wastes for colorless. */
function basicFor(basics: readonly LandCandidate[], color: ManaColor | "C") {
  return basics.find((card) => card.producedMana.length === 1 && card.producedMana[0] === color);
}

/** The rest of the lands as basics, each for the color that most needs one. */
function fillBasics(
  input: ManaBaseInput,
  count: number,
  gaps: Gaps,
  stats: DeckStats,
  deckColors: readonly ManaColor[],
): PlannedLand[] {
  const quantities = new Map<ManaColor | "C", number>();
  // Short of a color by its gap, then spread like the pips once every gap is closed.
  const need = new Map(deckColors.map((color) => [color, gaps.get(color) ?? 0]));
  const given = new Map<ManaColor, number>(deckColors.map((color) => [color, 0]));
  for (let added = 0; added < count; added += 1) {
    let color: ManaColor | "C" = "C";
    if (deckColors.length > 0) {
      color = [...deckColors].sort(
        (first, second) =>
          (need.get(second) ?? 0) - (need.get(first) ?? 0) ||
          (given.get(first) ?? 0) / stats.pips[first] -
            (given.get(second) ?? 0) / stats.pips[second] ||
          stats.pips[second] - stats.pips[first],
      )[0];
      need.set(color, Math.max(0, (need.get(color) ?? 0) - 1));
      given.set(color, (given.get(color) ?? 0) + 1);
    }
    if (basicFor(input.basics, color) === undefined) break;
    quantities.set(color, (quantities.get(color) ?? 0) + 1);
  }
  const planned: PlannedLand[] = [];
  for (const [color, quantity] of quantities) {
    const card = basicFor(input.basics, color);
    if (card === undefined) continue;
    planned.push({ card, quantity, tapped: "never", reasons: [{ kind: "basic", color }] });
  }
  return planned;
}
