import { cardThemes, leaderThemes, type Tag, type Theme } from "@/shared/card-search";
import type { Format } from "./deck";
import {
  deckStats,
  isLand,
  mainType,
  roleTargets,
  TARGETED_TAGS,
  type StatsLine,
  type TargetedTag,
} from "./stats";

// Deck suggestions (design doc 20, section 3.2): what a deck is about, and how well a card fits
// it. Pure: the queries fetch candidates, this decides their order and says why.

/** A deck line as the profile reads it: the statistics' line, plus its keyword abilities. */
export type ProfileLine = StatsLine & Readonly<{ keywords?: readonly string[] }>;

/** A card that could be suggested, from your collection or the store. */
export type CandidateCard = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  manaValue: number;
  keywords: readonly string[];
  roles: readonly Tag[];
  themes: readonly Theme[];
  rarity: string;
  priceCents: number | null;
  pool: "owned" | "store";
}>;

export type RoleGap = Readonly<{ tag: TargetedTag; count: number; target: number }>;

/** What a deck is about: worked out from its lines, never stored. */
export type DeckProfile = Readonly<{
  themes: readonly Theme[];
  /** Creature types the deck cares about, singular: "Elf". */
  tribes: readonly string[];
  /** Roles below the format's target. */
  gaps: readonly RoleGap[];
  /** The commanders' keyword abilities. */
  keywords: readonly string[];
}>;

/** Why a card is suggested; the builder puts these into words. */
export type Reason =
  | Readonly<{ kind: "theme"; theme: Theme }>
  | Readonly<{ kind: "tribe"; tribe: string }>
  | Readonly<{ kind: "role"; tag: Tag; count?: number; target?: number }>
  | Readonly<{ kind: "keyword"; keyword: string }>;

export type Scored = Readonly<{ card: CandidateCard; score: number; reasons: readonly Reason[] }>;

/** The points each kind of match is worth (section 3.2's table), in one place to tune. */
export const WEIGHTS = {
  theme: 3,
  tribe: 3,
  roleGap: 2,
  commanderKeyword: 1,
  commanderKeywordsCounted: 2,
  roleAsked: 2,
  likeRoleOrTheme: 3,
  likeKeyword: 2,
  likeKeywordsCounted: 3,
  likeCreatureType: 2,
  likeMainType: 1,
  likeManaValue: 1,
  strength: 0.5,
} as const;

/** A theme counts for a deck without a leader when this many non-land cards fit it… */
const THEME_MINIMUM = 4;
/** …and at least this share of the non-land cards. */
const THEME_SHARE = 0.1;
/** A creature type counts as a tribe when this many cards share it… */
const TRIBE_MINIMUM = 5;
/** …and at least this share of the creatures. */
const TRIBE_SHARE = 1 / 3;

/** The creature types on a card's front face: "Creature — Elf Druid" gives ["Elf", "Druid"]. */
export function creatureTypes(typeLine: string): string[] {
  const front = typeLine.split(" // ")[0];
  const [types, subtypes] = front.split(" — ");
  if (subtypes === undefined || !/\b(Creature|Kindred|Tribal)\b/.test(types)) return [];
  return subtypes.split(" ").filter((word) => word.length > 0);
}

/** Creature types whose plural doesn't follow the usual endings ("Mice" matter in Bloomburrow). */
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  Mouse: "Mice",
  Ox: "Oxen",
  Fungus: "Fungi",
  Goose: "Geese",
  Faerie: "Faeries",
  Elk: "Elk",
  Fish: "Fish",
  Sheep: "Sheep",
  Squid: "Squid",
  Djinn: "Djinn",
  Wolf: "Wolves",
};

/** How rules text writes a creature type in the plural: "Elf" → "Elves", "Rabbit" → "Rabbits". */
export function plural(type: string): string {
  const irregular = IRREGULAR_PLURALS[type];
  if (irregular !== undefined) return irregular;
  if (/f$/.test(type)) return `${type.slice(0, -1)}ves`;
  if (/[^aeiou]y$/.test(type)) return `${type.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(type)) return `${type}es`;
  return `${type}s`;
}

/** Whether a text names a creature type, singular or plural, as a whole word. */
function namesType(text: string, type: string): boolean {
  return new RegExp(`\\b(${type}|${plural(type)})\\b`).test(text);
}

/** What a deck is about (section 3.2, "Deck profile rules"). */
export function deckProfile(lines: readonly ProfileLine[], format: Format): DeckProfile {
  const commanders = lines.filter((line) => line.board === "commander");
  const main = lines.filter((line) => line.board === "main");
  const facts = (line: ProfileLine) => ({
    typeLine: line.typeLine,
    text: line.text ?? "",
    producedMana: line.producedMana,
  });

  // Themes: what the commanders lead, and what much of the deck already does.
  const themes = new Set<Theme>(commanders.flatMap((line) => leaderThemes(facts(line))));
  const spells = main.filter((line) => !isLand(line.typeLine));
  const spellCount = spells.reduce((sum, line) => sum + line.quantity, 0);
  const fitting = new Map<Theme, number>();
  for (const line of spells) {
    for (const theme of cardThemes(facts(line))) {
      fitting.set(theme, (fitting.get(theme) ?? 0) + line.quantity);
    }
  }
  for (const [theme, count] of fitting) {
    if (count >= THEME_MINIMUM && count >= spellCount * THEME_SHARE) themes.add(theme);
  }

  // Tribes: a commander's own type that its text names, and a type a third of the deck shares.
  const tribes = new Set<string>();
  for (const line of commanders) {
    for (const type of creatureTypes(line.typeLine)) {
      if (namesType(line.text ?? "", type)) tribes.add(type);
    }
  }
  const creatures = main.filter((line) => creatureTypes(line.typeLine).length > 0);
  const creatureCount = creatures.reduce((sum, line) => sum + line.quantity, 0);
  const byType = new Map<string, number>();
  for (const line of creatures) {
    for (const type of creatureTypes(line.typeLine)) {
      byType.set(type, (byType.get(type) ?? 0) + line.quantity);
    }
  }
  for (const [type, count] of byType) {
    if (count >= TRIBE_MINIMUM && count >= creatureCount * TRIBE_SHARE) tribes.add(type);
  }

  // Gaps: roles below the format's target. Formats without targets have none.
  const counts = deckStats(lines).tags;
  const targets = roleTargets(format);
  const gaps =
    targets === null
      ? []
      : TARGETED_TAGS.filter((tag) => counts[tag] < targets[tag]).map((tag) => ({
          tag,
          count: counts[tag],
          target: targets[tag],
        }));

  const keywords = [...new Set(commanders.flatMap((line) => line.keywords ?? []))];
  return { themes: [...themes], tribes: [...tribes], gaps, keywords };
}

const RARITY_STRENGTH: Readonly<Record<string, number>> = {
  common: 0,
  uncommon: 0.3,
  rare: 0.6,
  mythic: 0.8,
};

/**
 * How strong a card is on its own, about 0–1.6, from rarity and price (the idea of the drafts'
 * `cardStrength`): only a tie-break, never a reason to suggest a card.
 */
export function strength(card: Pick<CandidateCard, "rarity" | "priceCents">): number {
  const price = card.priceCents ?? 0;
  // log10 squeezes prices: $1 adds a little, $10 adds 0.8, $100 no more than $10.
  return (RARITY_STRENGTH[card.rarity] ?? 0.3) + 0.8 * Math.min(1, Math.log10(1 + price / 100));
}

/** A tribe counts for a card of that type, or a changeling (every type). */
function inTribe(card: CandidateCard, tribe: string): boolean {
  return (
    creatureTypes(card.typeLine).includes(tribe) ||
    card.keywords.some((keyword) => keyword.toLowerCase() === "changeling")
  );
}

/** Points and reasons for fitting a deck, without the strength tie-break. */
function deckFit(card: CandidateCard, profile: DeckProfile): { points: number; reasons: Reason[] } {
  const reasons: Reason[] = [];
  let points = 0;
  for (const theme of profile.themes) {
    if (!card.themes.includes(theme)) continue;
    points += WEIGHTS.theme;
    reasons.push({ kind: "theme", theme });
  }
  for (const tribe of profile.tribes) {
    if (!inTribe(card, tribe)) continue;
    points += WEIGHTS.tribe;
    reasons.push({ kind: "tribe", tribe });
  }
  for (const gap of profile.gaps) {
    if (!card.roles.includes(gap.tag)) continue;
    points += WEIGHTS.roleGap;
    reasons.push({ kind: "role", tag: gap.tag, count: gap.count, target: gap.target });
  }
  const shared = card.keywords.filter((keyword) => profile.keywords.includes(keyword));
  for (const keyword of shared.slice(0, WEIGHTS.commanderKeywordsCounted)) {
    points += WEIGHTS.commanderKeyword;
    reasons.push({ kind: "keyword", keyword });
  }
  return { points, reasons };
}

/** How well a card fits a deck, or null if it shares nothing with it. */
export function scoreForDeck(card: CandidateCard, profile: DeckProfile): Scored | null {
  const { points, reasons } = deckFit(card, profile);
  if (points === 0) return null;
  return { card, score: points + WEIGHTS.strength * strength(card), reasons };
}

/**
 * How good a card is for one role in this deck, or null if it doesn't do that job. The deck's
 * other gaps don't count here, or the same do-everything cards would top every role's list.
 */
export function scoreForRole(card: CandidateCard, tag: Tag, profile: DeckProfile): Scored | null {
  if (!card.roles.includes(tag)) return null;
  const fit = deckFit(card, { ...profile, gaps: [] });
  const gap = profile.gaps.find((candidate) => candidate.tag === tag);
  return {
    card,
    score: WEIGHTS.roleAsked + fit.points + WEIGHTS.strength * strength(card),
    reasons: [{ kind: "role", tag, count: gap?.count, target: gap?.target }, ...fit.reasons],
  };
}

/** How much a card is like another, or null if they share no role, theme, keyword or type. */
export function scoreLike(card: CandidateCard, target: CandidateCard): Scored | null {
  if (card.oracleId === target.oracleId) return null;
  const reasons: Reason[] = [];
  let points = 0;
  for (const tag of card.roles.filter((role) => target.roles.includes(role))) {
    points += WEIGHTS.likeRoleOrTheme;
    reasons.push({ kind: "role", tag });
  }
  for (const theme of card.themes.filter((one) => target.themes.includes(one))) {
    points += WEIGHTS.likeRoleOrTheme;
    reasons.push({ kind: "theme", theme });
  }
  const keywords = card.keywords.filter((keyword) => target.keywords.includes(keyword));
  for (const keyword of keywords.slice(0, WEIGHTS.likeKeywordsCounted)) {
    points += WEIGHTS.likeKeyword;
    reasons.push({ kind: "keyword", keyword });
  }
  const targetTypes = creatureTypes(target.typeLine);
  for (const type of creatureTypes(card.typeLine).filter((one) => targetTypes.includes(one))) {
    points += WEIGHTS.likeCreatureType;
    reasons.push({ kind: "tribe", tribe: type });
  }
  if (points === 0) return null;
  // Same kind of card, at about the same cost: closer, but never a reason on its own.
  if (mainType(card.typeLine) === mainType(target.typeLine)) points += WEIGHTS.likeMainType;
  if (Math.abs(card.manaValue - target.manaValue) <= 1) points += WEIGHTS.likeManaValue;
  return { card, score: points + WEIGHTS.strength * strength(card), reasons };
}

/** Highest score first; at equal scores, cards you own first, then by name. */
export function rank(scored: readonly (Scored | null)[]): Scored[] {
  return scored
    .filter((entry): entry is Scored => entry !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.card.pool === "owned") - Number(a.card.pool === "owned") ||
        a.card.name.localeCompare(b.card.name),
    );
}

/** Prices below this count as this much when comparing value (design doc 20, decision 4). */
const PRICE_FLOOR_CENTS = 100;

/**
 * Store cards that fit, most points per dollar first, never over the budget (invariant 5).
 * Greedy: take the best value that still fits, skip what doesn't, stop at `maxCards`.
 */
export function budgetPicks(
  scored: readonly Scored[],
  budgetCents: number,
  maxCards: number,
): Scored[] {
  const value = (entry: Scored) =>
    entry.score / Math.max(PRICE_FLOOR_CENTS, entry.card.priceCents ?? 0);
  const affordable = scored.filter(
    (entry) => entry.card.pool === "store" && entry.card.priceCents !== null,
  );
  const byValue = [...affordable].sort(
    (a, b) => value(b) - value(a) || b.score - a.score || a.card.name.localeCompare(b.card.name),
  );
  const picks: Scored[] = [];
  const chosen = new Set<string>();
  let spent = 0;
  for (const entry of byValue) {
    if (picks.length >= maxCards) break;
    const price = entry.card.priceCents ?? 0;
    if (chosen.has(entry.card.oracleId) || spent + price > budgetCents) continue;
    picks.push(entry);
    chosen.add(entry.card.oracleId);
    spent += price;
  }
  return picks;
}
