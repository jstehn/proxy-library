import type { Theme } from "@/shared/card-search";
import {
  deckFit,
  deckProfile,
  rank,
  scoreForDeck,
  strength,
  type CandidateCard,
  type DeckProfile,
  type Scored,
} from "./suggest";
import {
  isLand,
  MANA_COLORS,
  roleTargets,
  TARGETED_TAGS,
  type ManaColor,
  type TargetedTag,
} from "./stats";

// Commanders I can build (design doc 36, section 3): for each card that could lead a deck, how
// much of a Commander deck your owned cards already cover. Pure: the queries gather the rows.

/** An owned card the coverage counts (one per oracle card), or a store card for the missing part. */
export type PoolCard = CandidateCard & Readonly<{ colorIdentity: readonly ManaColor[] }>;

/** A card that could lead the deck. */
export type CommanderCandidate = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  text: string;
  colorIdentity: readonly ManaColor[];
  keywords: readonly string[];
  isGameChanger: boolean;
  /** Copies you own (0 for a store legend). */
  ownedCopies: number;
  /** Store price of its cheapest printing, for a legend you don't own; otherwise null. */
  priceCents: number | null;
  /** Your decks that already have it as commander: a note, never a reason to leave it out. */
  leads: readonly string[];
}>;

/** Anything with a color identity (an owned land, for the lands note). */
export type WithIdentity = Readonly<{ colorIdentity: readonly ManaColor[] }>;

export type RoleCoverage = Readonly<{ tag: TargetedTag; have: number; target: number }>;

/** What the commander's text leads, as the deck profile reads it. */
export type CommanderPlan = Readonly<{
  themes: readonly Theme[];
  tribes: readonly string[];
  keywords: readonly string[];
}>;

export type CommanderCoverage = Readonly<{
  commander: CommanderCandidate;
  plan: CommanderPlan;
  /** On-color cards you own that share a theme, tribe or keyword with the plan. */
  onPlan: number;
  roles: readonly RoleCoverage[];
  /** Spell slots your on-color cards could fill, out of SPELL_SLOTS. */
  filled: number;
  /** On-color non-basic lands you own (basics are free): a note, not in the score. */
  ownedLands: number;
  score: number;
}>;

export type CoverageDetails = Readonly<{
  coverage: CommanderCoverage;
  /** Your on-plan cards, best fit first, with the reasons they fit. */
  onPlan: readonly Scored[];
  /** Your on-color cards for each role, strongest first. */
  byRole: Readonly<Record<TargetedTag, readonly PoolCard[]>>;
}>;

/** A store card that could fill a gap: a role still short, or a slot your cards can't fill. */
export type MissingPick = Readonly<{ card: PoolCard; fills: TargetedTag | "plan" }>;

export type MissingCost = Readonly<{ picks: readonly MissingPick[]; totalCents: number }>;

/** A 99-card deck minus the usual 37 lands (design doc 35's base land count). */
export const SPELL_SLOTS = 62;

/** The score's parts (section 3.1), in one place to tune. */
export const COMMANDER_WEIGHTS = {
  onPlan: 2,
  onPlanCap: 30,
  role: 1,
  filled: 0.5,
} as const;

const COLOR_BITS: Readonly<Record<ManaColor, number>> = { W: 1, U: 2, B: 4, R: 8, G: 16 };

/** A color identity as five bits (W=1, U=2, B=4, R=8, G=16), so "within" is one `&`. */
export function colorMask(colors: readonly string[]): number {
  let mask = 0;
  for (const color of colors) {
    if ((MANA_COLORS as readonly string[]).includes(color)) mask |= COLOR_BITS[color as ManaColor];
  }
  return mask;
}

/** Whether an identity mask stays inside a commander's: no bit the commander lacks. */
export function withinIdentity(cardMask: number, commanderMask: number): boolean {
  return (cardMask & ~commanderMask) === 0;
}

/** The deck profile of a deck that holds only this commander: its plan, and every role short. */
function commanderProfile(candidate: CommanderCandidate): DeckProfile {
  return deckProfile(
    [
      {
        quantity: 1,
        manaValue: 0,
        typeLine: candidate.typeLine,
        board: "commander",
        text: candidate.text,
        keywords: candidate.keywords,
      },
    ],
    "commander",
  );
}

/** The profile without role gaps: "on-plan" is about themes, tribes and keywords only. */
const planOnly = (profile: DeckProfile): DeckProfile => ({ ...profile, gaps: [] });

const TARGETS = roleTargets("commander") ?? { ramp: 10, draw: 10, removal: 8, wipe: 3 };

/** A pool card with its identity worked out once, for every candidate to check. */
type MaskedCard = Readonly<{ card: PoolCard; mask: number }>;

function masked(pool: readonly PoolCard[]): MaskedCard[] {
  return pool
    .filter((card) => !isLand(card.typeLine))
    .map((card) => ({ card, mask: colorMask(card.colorIdentity) }));
}

/** The on-color non-land cards for one candidate, never the candidate itself. */
function onColor(candidate: CommanderCandidate, pool: readonly MaskedCard[]): PoolCard[] {
  const mask = colorMask(candidate.colorIdentity);
  return pool
    .filter((entry) => entry.card.oracleId !== candidate.oracleId)
    .filter((entry) => withinIdentity(entry.mask, mask))
    .map((entry) => entry.card);
}

function coverageOf(
  candidate: CommanderCandidate,
  cards: readonly PoolCard[],
  landMasks: readonly number[],
): CommanderCoverage {
  const profile = commanderProfile(candidate);
  const plan = planOnly(profile);
  const onPlan = cards.filter((card) => deckFit(card, plan).points > 0).length;
  const roles = TARGETED_TAGS.map((tag) => ({
    tag,
    have: Math.min(TARGETS[tag], cards.filter((card) => card.roles.includes(tag)).length),
    target: TARGETS[tag],
  }));
  const roleCoverage = roles.reduce((sum, role) => sum + role.have, 0);
  const filled = Math.min(SPELL_SLOTS, cards.length);
  const mask = colorMask(candidate.colorIdentity);
  const score =
    COMMANDER_WEIGHTS.onPlan * Math.min(onPlan, COMMANDER_WEIGHTS.onPlanCap) +
    COMMANDER_WEIGHTS.role * roleCoverage +
    COMMANDER_WEIGHTS.filled * filled;
  return {
    commander: candidate,
    plan: { themes: profile.themes, tribes: profile.tribes, keywords: profile.keywords },
    onPlan,
    roles,
    filled,
    ownedLands: landMasks.filter((land) => withinIdentity(land, mask)).length,
    score,
  };
}

/** Highest score first; at equal scores, commanders you own first, then by name. */
function byScore(a: CommanderCoverage, b: CommanderCoverage): number {
  return (
    b.score - a.score ||
    Number(b.commander.ownedCopies > 0) - Number(a.commander.ownedCopies > 0) ||
    a.commander.name.localeCompare(b.commander.name)
  );
}

/** Every candidate's coverage from your pool, highest score first (design doc 36, 3.1). */
export function rankCommanders(
  candidates: readonly CommanderCandidate[],
  pool: readonly PoolCard[],
  ownedLands: readonly WithIdentity[],
): CommanderCoverage[] {
  const cards = masked(pool);
  const landMasks = ownedLands.map((land) => colorMask(land.colorIdentity));
  return candidates
    .map((candidate) => coverageOf(candidate, onColor(candidate, cards), landMasks))
    .sort(byScore);
}

/** Strongest first, then by name: the order role lists show. */
function strongestFirst(a: PoolCard, b: PoolCard): number {
  return strength(b) - strength(a) || a.name.localeCompare(b.name);
}

/** One candidate in detail: which of your cards are on-plan, and which fill each role. */
export function coverageDetails(
  candidate: CommanderCandidate,
  pool: readonly PoolCard[],
  ownedLands: readonly WithIdentity[],
): CoverageDetails {
  const cards = onColor(candidate, masked(pool));
  const landMasks = ownedLands.map((land) => colorMask(land.colorIdentity));
  const plan = planOnly(commanderProfile(candidate));
  const byRole = Object.fromEntries(
    TARGETED_TAGS.map((tag) => [
      tag,
      cards.filter((card) => card.roles.includes(tag)).sort(strongestFirst),
    ]),
  ) as Record<TargetedTag, PoolCard[]>;
  return {
    coverage: coverageOf(candidate, cards, landMasks),
    onPlan: rank(cards.map((card) => scoreForDeck(card, plan))),
    byRole,
  };
}

/** Cheapest first (unknown prices last), then by name. */
function cheapestFirst(a: PoolCard, b: PoolCard): number {
  const price = (card: PoolCard) => card.priceCents ?? Number.MAX_SAFE_INTEGER;
  return price(a) - price(b) || a.name.localeCompare(b.name);
}

/**
 * The cheapest store cards that would close the gaps (section 9): for each role still short,
 * that many on-color store cards with the role; then on-plan store cards for the spell slots
 * your cards can't fill. An estimate, never a shopping list.
 */
export function missingCost(coverage: CommanderCoverage, store: readonly PoolCard[]): MissingCost {
  const candidate = coverage.commander;
  const cards = onColor(candidate, masked(store))
    .filter((card) => card.priceCents !== null)
    .sort(cheapestFirst);
  const chosen = new Set<string>();
  const picks: MissingPick[] = [];
  const take = (card: PoolCard, fills: MissingPick["fills"]) => {
    chosen.add(card.oracleId);
    picks.push({ card, fills });
  };

  for (const role of coverage.roles) {
    const short = role.target - role.have;
    const fitting = cards.filter(
      (card) => !chosen.has(card.oracleId) && card.roles.includes(role.tag),
    );
    for (const card of fitting.slice(0, Math.max(0, short))) take(card, role.tag);
  }

  const plan = planOnly(commanderProfile(candidate));
  const emptySlots = Math.max(0, SPELL_SLOTS - coverage.filled - picks.length);
  const onPlan = cards.filter(
    (card) => !chosen.has(card.oracleId) && deckFit(card, plan).points > 0,
  );
  for (const card of onPlan.slice(0, emptySlots)) take(card, "plan");

  return { picks, totalCents: picks.reduce((sum, pick) => sum + (pick.card.priceCents ?? 0), 0) };
}
