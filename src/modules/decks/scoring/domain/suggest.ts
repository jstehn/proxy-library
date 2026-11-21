import { creatureTypes, manaCurve, type Tag, type Theme } from "@/shared/mtg";
import {
  isPlayed,
  formatRules,
  deckStats,
  isLand,
  TARGETED_TAGS,
  type EdhrecSignal,
  type ProfileLine,
  type StatsLine,
} from "@/modules/decks/core/client";
import type { Format } from "@/modules/decks/core/client";
import {
  edhrecLogLift,
  emptyRatingProfile,
  rateCard,
  type CardRating,
  type RatingCandidate,
  type RatingOptions,
  type RatingProfile,
} from "./rate";
import { RATING_WEIGHTS } from "./rating-weights";
import { deckSignalProfile } from "./signals";

// Deck suggestions (design doc 20, section 3.2): what a deck is about, and how well a card fits
// it. Pure: the queries fetch candidates, this decides their order and says why. The order always
// comes from `rateCard` (rate.ts), the one scorer; this file adds the reasons in words.

/** A card that could be suggested, from your collection or the store. */
export type CandidateCard = RatingCandidate &
  Readonly<{
    text?: string;
    pool: "owned" | "store";
    isGameChanger?: boolean;
  }>;

/** What a deck is about: worked out from its lines, never stored. */
export type DeckFingerprint = RatingProfile;

/** Popular or high-synergy with this deck's commander on EDHREC (design doc 45). */
export type EdhrecReason = Readonly<{
  kind: "edhrec";
  inclusionPct: number;
  synergyPct: number;
  lift?: number;
}>;

/** Why a card is suggested; the builder puts these into words. */
export type Reason =
  | Readonly<{ kind: "theme"; theme: Theme }>
  | Readonly<{ kind: "tribe"; tribe: string }>
  | Readonly<{ kind: "role"; tag: Tag; count?: number; target?: number }>
  | Readonly<{ kind: "keyword"; keyword: string }>
  | EdhrecReason
  | Readonly<{ kind: "synergy"; label: string }>
  | Readonly<{ kind: "combo"; partners: readonly string[] }>
  | Readonly<{ kind: "embedSim"; similarityPct: number }>;

/** A card the scorer rated, with the reasons it fits. */
export type Scored = Readonly<{
  card: CandidateCard;
  reasons: readonly Reason[];
  rating: CardRating;
}>;

/** A theme counts for a deck without a leader when this many non-land cards fit it… */
const THEME_MINIMUM = 4;
/** …and at least this share of the non-land cards. */
const THEME_SHARE = 0.1;
/** A creature type counts as a tribe when this many cards share it… */
const TRIBE_MINIMUM = 5;
/** …and at least this share of the creatures. */
const TRIBE_SHARE = 1 / 3;

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
export function deckProfile(lines: readonly ProfileLine[], format: Format): DeckFingerprint {
  const commanders = lines.filter((line) => line.board === "commander");
  const main = lines.filter((line) => line.board === "main");

  // Themes: what the commanders lead, and what much of the deck already does.
  const themes = new Set<Theme>(commanders.flatMap((line) => line.leaderThemes ?? []));
  const spells = main.filter((line) => !isLand(line.typeLine));
  const spellCount = spells.reduce((sum, line) => sum + line.quantity, 0);
  const fitting = new Map<Theme, number>();
  for (const line of spells) {
    for (const theme of line.themes ?? []) {
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
  const stats = deckStats(lines);
  const counts = stats.tags;
  const targets = formatRules(format).roleTargets;
  const gaps =
    targets === null
      ? []
      : TARGETED_TAGS.filter((tag) => counts[tag] < targets[tag]).map((tag) => ({
          tag,
          count: counts[tag],
          target: targets[tag],
        }));

  const signals = deckSignalProfile(lines.filter((line) => isPlayed(line.board)));
  const curveCounts = manaCurve(spells);

  const keywords = [...new Set(commanders.flatMap((line) => line.keywords ?? []))];
  return {
    format,
    themes: [...themes],
    tribes: [...tribes],
    gaps,
    keywords,
    signals,
    averageManaValue: stats.averageManaValue,
    curveCounts,
  };
}

/** A tribe counts for a card of that type, or a changeling (every type). */
function inTribe(card: CandidateCard, tribe: string): boolean {
  return (
    creatureTypes(card.typeLine).includes(tribe) ||
    card.keywords.some((keyword) => keyword.toLowerCase() === "changeling")
  );
}

/** What a card shares with the deck's themes, tribes, short roles and commander keywords. */
export function fitReasons(card: CandidateCard, profile: DeckFingerprint): Reason[] {
  const reasons: Reason[] = [];
  for (const theme of profile.themes) {
    if (card.themes.includes(theme)) reasons.push({ kind: "theme", theme });
  }
  for (const tribe of profile.tribes) {
    if (inTribe(card, tribe)) reasons.push({ kind: "tribe", tribe });
  }
  for (const gap of profile.gaps) {
    if (card.roles.includes(gap.tag)) {
      reasons.push({ kind: "role", tag: gap.tag, count: gap.count, target: gap.target });
    }
  }
  const shared = card.keywords.filter((keyword) => profile.keywords.includes(keyword));
  for (const keyword of shared.slice(0, RATING_WEIGHTS.keywordCap)) {
    reasons.push({ kind: "keyword", keyword });
  }
  return reasons;
}

/** The EDHREC reason, if the card is popular or high-synergy enough to be worth saying. */
export function edhrecReason(
  edhrec: EdhrecSignal | null | undefined,
  minimumSynergy: number,
  minimumInclusion: number,
): EdhrecReason | null {
  if (!edhrec) return null;
  if (edhrec.synergy < minimumSynergy && edhrec.inclusionRate < minimumInclusion) return null;
  const lift = Math.max(0, Math.min(2, edhrecLogLift(edhrec.inclusionRate, edhrec.synergy)));
  return {
    kind: "edhrec",
    inclusionPct: Math.round(edhrec.inclusionRate * 100),
    synergyPct: Math.round(edhrec.synergy * 100),
    lift: Math.round(lift * 100) / 100,
  };
}

/** The reasons the rating itself found: synergy, a combo, similar text. */
function ratingReasons(card: CandidateCard, rating: CardRating): Reason[] {
  const reasons: Reason[] = [];
  const synergy = rating.parts.find((part) => part.kind === "synergy");
  if (synergy) reasons.push({ kind: "synergy", label: synergy.label });
  if (card.comboPartners && card.comboPartners.length > 0) {
    if (rating.parts.some((part) => part.kind === "combo")) {
      reasons.push({ kind: "combo", partners: card.comboPartners });
    }
  }
  if (card.embedSim != null && rating.parts.some((part) => part.kind === "embedSim")) {
    reasons.push({ kind: "embedSim", similarityPct: Math.round(card.embedSim * 100) });
  }
  return reasons;
}

/** How well a card fits a deck, or null if it shares nothing with it. */
export function scoreForDeck(
  card: CandidateCard,
  profile: DeckFingerprint,
  options?: RatingOptions,
): Scored | null {
  const rating = rateCard(card, profile, options);
  const reasons = [...fitReasons(card, profile), ...ratingReasons(card, rating)];
  const edhrec = edhrecReason(card.edhrec, 0.05, 0.15);
  if (edhrec !== null) reasons.push(edhrec);
  return reasons.length === 0 ? null : { card, reasons, rating };
}

/**
 * How good a card is for one role in this deck, or null if it doesn't do that job. The deck's
 * other gaps don't count here, or the same do-everything cards would top every role's list.
 */
export function scoreForRole(
  card: CandidateCard,
  tag: Tag,
  profile: DeckFingerprint,
  options?: RatingOptions,
): Scored | null {
  if (!card.roles.includes(tag)) return null;
  const gap = profile.gaps.find((candidate) => candidate.tag === tag);
  const rating = rateCard(card, { ...profile, gaps: gap ? [gap] : [] }, options);
  const fit = fitReasons(card, { ...profile, gaps: [] });
  return {
    card,
    reasons: [{ kind: "role", tag, count: gap?.count, target: gap?.target }, ...fit],
    rating,
  };
}

/** The profile of a deck made of just this card: what "cards like it" are rated against. */
function likeProfile(target: CandidateCard): DeckFingerprint {
  return {
    ...emptyRatingProfile("commander"),
    themes: target.themes,
    tribes: creatureTypes(target.typeLine),
    keywords: target.keywords,
    gaps: TARGETED_TAGS.filter((tag) => target.roles.includes(tag)).map((tag) => ({
      tag,
      count: 0,
      target: 1,
    })),
    averageManaValue: target.manaValue,
  };
}

/** How much a card is like another, or null if they share no role, theme, keyword or type. */
export function scoreLike(card: CandidateCard, target: CandidateCard): Scored | null {
  if (card.oracleId === target.oracleId) return null;
  const profile = likeProfile(target);
  const rating = rateCard(card, profile);
  const sharedRoles = card.roles.filter((tag) => target.roles.includes(tag));
  const reasons = [
    ...sharedRoles.map((tag): Reason => ({ kind: "role", tag })),
    ...fitReasons(card, { ...profile, gaps: [] }),
    ...ratingReasons(card, rating),
  ];
  return reasons.length === 0 ? null : { card, reasons, rating };
}

/** Best rated first; at equal ratings, cards you own first, then by name. */
export function rank(scored: readonly (Scored | null)[]): Scored[] {
  return scored
    .filter((entry): entry is Scored => entry !== null)
    .sort(
      (a, b) =>
        b.rating.logit - a.rating.logit ||
        Number(b.card.pool === "owned") - Number(a.card.pool === "owned") ||
        a.card.name.localeCompare(b.card.name),
    );
}

/** Prices below this count as this much when comparing value (design doc 20, decision 4). */
const PRICE_FLOOR_CENTS = 100;

/**
 * Store cards that fit, best rating per dollar first, never over the budget (invariant 5).
 * Greedy: take the best value that still fits, skip what doesn't, stop at `maxCards`.
 */
export function budgetPicks(
  scored: readonly Scored[],
  budgetCents: number,
  maxCards: number,
): Scored[] {
  const value = (entry: Scored) =>
    entry.rating.rating / Math.max(PRICE_FLOOR_CENTS, entry.card.priceCents ?? 0);
  const affordable = scored.filter(
    (entry) => entry.card.pool === "store" && entry.card.priceCents !== null,
  );
  const byValue = [...affordable].sort(
    (a, b) =>
      value(b) - value(a) ||
      b.rating.logit - a.rating.logit ||
      a.card.name.localeCompare(b.card.name),
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
