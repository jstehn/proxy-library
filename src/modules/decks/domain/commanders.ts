import type { Tag, Theme } from "@/shared/card-search";
import {
  creatureTypes,
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

// Commanders I can build (design docs 36 and 39): for each card that could lead a deck, how
// much of a Commander deck your owned cards already cover, plus popularity and power heuristics.
// Pure: the queries gather the rows.

export const COMMANDER_SORTS = ["coverage", "popularity", "power", "combined"] as const;
export type CommanderSort = (typeof COMMANDER_SORTS)[number];

export type RankCommandersOptions = Readonly<{
  sort?: CommanderSort;
  /** Keep only commanders whose plan.themes includes this theme. */
  theme?: Theme;
  /** Keep only commanders whose plan.tribes or own creature types include this tribe (case-insensitive). */
  tribe?: string;
}>;

/** An owned card the coverage counts (one per oracle card), or a store card for the missing part. */
export type PoolCard = CandidateCard & Readonly<{ colorIdentity: readonly ManaColor[] }>;

/** A card that could lead the deck. */
export type CommanderCandidate = Readonly<{
  oracleId: string;
  /** The printing to show: your most-held copy, or the store's cheapest. */
  printingId: string;
  name: string;
  manaCost?: string | null;
  manaValue?: number;
  typeLine: string;
  text: string;
  colorIdentity: readonly ManaColor[];
  keywords: readonly string[];
  rarity?: string;
  roles?: readonly Tag[];
  isGameChanger: boolean;
  /** Scryfall's EDHREC popularity rank (1 = most popular on EDHREC, null when unranked). */
  edhrecRank?: number | null;
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
  /** Collection coverage score (design doc 36, section 3.1). */
  score: number;
  /** Card power heuristic (design doc 39, section 3.1): Game Changer, card strength, plan richness, popularity. */
  powerScore: number;
  /** Blend of collection coverage + popularity + power (design doc 39, section 3.1). */
  combinedScore: number;
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

/**
 * A pool card with what every candidate checks worked out once: its identity mask, creature
 * types and whether it's a changeling. Ranking thousands of legends against thousands of cards
 * repeats these checks millions of times.
 */
type PreparedCard = Readonly<{
  card: PoolCard;
  mask: number;
  types: readonly string[];
  isChangeling: boolean;
  /** Which targeted roles it does, in TARGETED_TAGS order. */
  roles: readonly boolean[];
}>;

function prepare(pool: readonly PoolCard[]): PreparedCard[] {
  return pool
    .filter((card) => !isLand(card.typeLine))
    .map((card) => ({
      card,
      mask: colorMask(card.colorIdentity),
      types: creatureTypes(card.typeLine),
      isChangeling: card.keywords.some((keyword) => keyword.toLowerCase() === "changeling"),
      roles: TARGETED_TAGS.map((tag) => card.roles.includes(tag)),
    }));
}

/** The on-color non-land cards for one candidate, never the candidate itself. */
function onColor(candidate: CommanderCandidate, pool: readonly PreparedCard[]): PreparedCard[] {
  const mask = colorMask(candidate.colorIdentity);
  return pool.filter(
    (entry) => entry.card.oracleId !== candidate.oracleId && withinIdentity(entry.mask, mask),
  );
}

/**
 * Whether a card shares a theme, tribe or keyword with the plan: `deckFit(card, plan).points > 0`
 * (every weight is positive), without building the reasons. A test checks the two agree.
 */
export function sharesPlan(entry: PreparedCard, plan: DeckProfile): boolean {
  const { card } = entry;
  return (
    plan.themes.some((theme) => card.themes.includes(theme)) ||
    plan.tribes.some((tribe) => entry.isChangeling || entry.types.includes(tribe)) ||
    plan.keywords.some((keyword) => card.keywords.includes(keyword))
  );
}

/** For tests: a pool card as the ranking prepares it. */
export const preparedForTest = (card: PoolCard): PreparedCard => prepare([card])[0];

/**
 * Bounded popularity bonus (0 to 25 points) from Scryfall's EDHREC rank (design doc 39, 3.1).
 * Rank <= 10 gives 25; rank 1,000 gives ~10.7; rank >= 31,623 or null gives 0.
 */
export function popularityBonus(edhrecRank: number | null | undefined): number {
  if (edhrecRank === null || edhrecRank === undefined || edhrecRank <= 0) return 0;
  const clamped = Math.max(10, edhrecRank);
  const raw = 25 * (1 - (Math.log10(clamped) - 1) / 3.5);
  return Math.round(Math.max(0, Math.min(25, raw)) * 10) / 10;
}

/**
 * Heuristic power score for a commander candidate (design doc 39, 3.1): combines Wizards' Game
 * Changer flag, card strength (rarity + low-mana efficiency + roles), plan richness, and popularity.
 */
export function commanderPowerScore(candidate: CommanderCandidate, plan: CommanderPlan): number {
  const cardStrength = strength({
    rarity: candidate.rarity ?? "rare",
    priceCents: candidate.priceCents,
  });
  const roleBonus = Math.min(4, (candidate.roles?.length ?? 0) * 2);
  const efficiencyBonus =
    candidate.manaValue !== undefined && candidate.manaValue <= 3
      ? 3 - Math.min(2, Math.max(0, candidate.manaValue - 1))
      : 0;
  const planRichness = Math.min(6, plan.themes.length * 2 + plan.tribes.length * 2);
  const raw =
    (candidate.isGameChanger ? 12 : 0) +
    2 * cardStrength +
    roleBonus +
    efficiencyBonus +
    planRichness +
    0.4 * popularityBonus(candidate.edhrecRank);
  return Math.round(raw * 10) / 10;
}

function coverageOf(
  candidate: CommanderCandidate,
  cards: readonly PreparedCard[],
  landMasks: readonly number[],
): CommanderCoverage {
  const profile = commanderProfile(candidate);
  const plan = planOnly(profile);
  const roleCounts = TARGETED_TAGS.map(() => 0);
  let onPlan = 0;
  for (const entry of cards) {
    if (sharesPlan(entry, plan)) onPlan += 1;
    entry.roles.forEach((does, index) => {
      if (does) roleCounts[index] += 1;
    });
  }
  const roles = TARGETED_TAGS.map((tag, index) => ({
    tag,
    have: Math.min(TARGETS[tag], roleCounts[index]),
    target: TARGETS[tag],
  }));
  const roleCoverage = roles.reduce((sum, role) => sum + role.have, 0);
  const filled = Math.min(SPELL_SLOTS, cards.length);
  const mask = colorMask(candidate.colorIdentity);
  const score =
    COMMANDER_WEIGHTS.onPlan * Math.min(onPlan, COMMANDER_WEIGHTS.onPlanCap) +
    COMMANDER_WEIGHTS.role * roleCoverage +
    COMMANDER_WEIGHTS.filled * filled;
  const commanderPlan: CommanderPlan = {
    themes: profile.themes,
    tribes: profile.tribes,
    keywords: profile.keywords,
  };
  const powerScore = commanderPowerScore(candidate, commanderPlan);
  const combinedScore =
    Math.round((score + popularityBonus(candidate.edhrecRank) + 0.5 * powerScore) * 10) / 10;
  return {
    commander: candidate,
    plan: commanderPlan,
    onPlan,
    roles,
    filled,
    ownedLands: landMasks.filter((land) => withinIdentity(land, mask)).length,
    score,
    powerScore,
    combinedScore,
  };
}

const ownedTie = (a: CommanderCoverage, b: CommanderCoverage) =>
  Number(b.commander.ownedCopies > 0) - Number(a.commander.ownedCopies > 0);

const edhrecTie = (a: CommanderCoverage, b: CommanderCoverage) => {
  const rankA = a.commander.edhrecRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.commander.edhrecRank ?? Number.MAX_SAFE_INTEGER;
  return rankA - rankB;
};

const nameTie = (a: CommanderCoverage, b: CommanderCoverage) =>
  a.commander.name.localeCompare(b.commander.name);

function comparatorFor(
  sort: CommanderSort,
): (a: CommanderCoverage, b: CommanderCoverage) => number {
  switch (sort) {
    case "popularity":
      return (a, b) => edhrecTie(a, b) || b.score - a.score || ownedTie(a, b) || nameTie(a, b);
    case "power":
      return (a, b) =>
        b.powerScore - a.powerScore ||
        b.score - a.score ||
        edhrecTie(a, b) ||
        ownedTie(a, b) ||
        nameTie(a, b);
    case "combined":
      return (a, b) =>
        b.combinedScore - a.combinedScore || ownedTie(a, b) || edhrecTie(a, b) || nameTie(a, b);
    case "coverage":
      return (a, b) => b.score - a.score || ownedTie(a, b) || edhrecTie(a, b) || nameTie(a, b);
  }
}

function matchesTribe(coverage: CommanderCoverage, tribe: string): boolean {
  const target = tribe.trim().toLowerCase();
  if (target === "") return true;
  return (
    coverage.plan.tribes.some((entry) => entry.toLowerCase() === target) ||
    creatureTypes(coverage.commander.typeLine).some((entry) => entry.toLowerCase() === target)
  );
}

/** Every candidate's coverage from your pool, filtered and ordered by `options` (design docs 36 & 39). */
export function rankCommanders(
  candidates: readonly CommanderCandidate[],
  pool: readonly PoolCard[],
  ownedLands: readonly WithIdentity[],
  options: RankCommandersOptions = {},
): CommanderCoverage[] {
  const cards = prepare(pool);
  const landMasks = ownedLands.map((land) => colorMask(land.colorIdentity));
  const sort = options.sort ?? "coverage";
  return candidates
    .map((candidate) => coverageOf(candidate, onColor(candidate, cards), landMasks))
    .filter(
      (coverage) => options.theme === undefined || coverage.plan.themes.includes(options.theme),
    )
    .filter((coverage) => options.tribe === undefined || matchesTribe(coverage, options.tribe))
    .sort(comparatorFor(sort));
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
  const prepared = onColor(candidate, prepare(pool));
  const cards = prepared.map((entry) => entry.card);
  const landMasks = ownedLands.map((land) => colorMask(land.colorIdentity));
  const plan = planOnly(commanderProfile(candidate));
  const byRole = Object.fromEntries(
    TARGETED_TAGS.map((tag) => [
      tag,
      cards.filter((card) => card.roles.includes(tag)).sort(strongestFirst),
    ]),
  ) as Record<TargetedTag, PoolCard[]>;
  return {
    coverage: coverageOf(candidate, prepared, landMasks),
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
  const plan = planOnly(commanderProfile(candidate));
  const prepared = onColor(candidate, prepare(store))
    .filter((entry) => entry.card.priceCents !== null)
    .sort((a, b) => cheapestFirst(a.card, b.card));
  const cards = prepared.map((entry) => entry.card);
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

  const emptySlots = Math.max(0, SPELL_SLOTS - coverage.filled - picks.length);
  const onPlan = prepared.filter(
    (entry) => !chosen.has(entry.card.oracleId) && sharesPlan(entry, plan),
  );
  for (const entry of onPlan.slice(0, emptySlots)) take(entry.card, "plan");

  return { picks, totalCents: picks.reduce((sum, pick) => sum + (pick.card.priceCents ?? 0), 0) };
}
