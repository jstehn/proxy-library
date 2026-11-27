import { SIGNAL_KINDS, type SignalIO, type SignalKind, type Tag, type Theme } from "@/shared/mtg";
import type { SignalFact } from "@/modules/catalog";
import type { DeckCount } from "@/modules/decks/core/client";

// Signals (design docs 28, 46 and 66), counted over a deck: what a group of cards keeps doing. A
// Shroofus deck full of spore counters and Saprolings says "proliferate" and "token payoffs" even
// though Shroofus's own text says neither. What each card shows (counters, tokens, creature types,
// triggers, costs) and which themes it makes and uses are card features (catalog recognizers);
// this counts them, adds recurring phrases from the plain text, and leaves the judgment to whoever
// reads it, a player or an LLM. Pure.

/** What counting reads about one card: its features. */
export type SignalCard = Readonly<{
  name: string;
  roleTags: readonly Tag[];
  themes: readonly Theme[];
  signals: readonly SignalFact[];
  faces: readonly Readonly<{ plainText: string }>[];
}>;

/** One thing several cards have in common, with the cards that show it. */
export type Signal = Readonly<{
  kind: SignalKind;
  /** "spore counter", "Saproling token", "Fungus", "dies trigger", "for each fungus". */
  name: string;
  /** How many of the cards show it. */
  cards: number;
  /** Up to five of those cards, by name. */
  examples: readonly string[];
  /** A card search (the search language) that finds more cards like these. */
  followUp: string;
}>;

export type SignalOptions = Readonly<{
  /** A signal must appear on at least this many cards (default 3). */
  minimumCards?: number;
  /** At most this many signals (default 40), most cards first. */
  limit?: number;
}>;

const EXAMPLES = 5;
const MAX_PHRASES = 12;

/** Quotes a phrase for the search language, or writes it as a pattern if it has quotes. */
function oracle(phrase: string): string {
  return phrase.includes('"') ? `o:/${phrase.replace(/"/g, ".")}/` : `o:"${phrase}"`;
}

/** Everything one card shows, each signal once. */
function findingsFor(card: SignalCard): SignalFact[] {
  const findings: SignalFact[] = [
    ...card.signals,
    ...card.roleTags.map((tag) => ({ kind: "role" as const, name: tag, followUp: `tag:${tag}` })),
    ...card.themes.map((theme) => ({
      kind: "theme" as const,
      name: theme,
      followUp: `theme:${theme}`,
    })),
  ];
  const unique = new Map<string, SignalFact>();
  for (const finding of findings) unique.set(`${finding.kind}:${finding.name}`, finding);
  return [...unique.values()];
}

// --- Recurring phrases ------------------------------------------------------------------

/** Words too common to start or end a phrase. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "and",
  "or",
  "you",
  "your",
  "it",
  "its",
  "that",
  "this",
  "on",
  "in",
  "into",
  "for",
  "with",
  "from",
  "at",
  "as",
  "is",
  "are",
  "be",
  "by",
  "then",
  "if",
  "may",
  "can",
  "any",
  "all",
  "where",
  "has",
  "have",
  "was",
  "were",
  "do",
  "does",
  "isn't",
  "don't",
  "their",
  "they",
  "them",
  "those",
  "these",
  "up",
  "until",
  "unless",
  "instead",
  "each",
  "one",
  "two",
  "three",
  "x",
]);

/** Words in almost every card's rules: a phrase made only of these (and stop words) says nothing. */
const GENERIC_WORDS = new Set([
  "control",
  "controls",
  "turn",
  "end",
  "target",
  "creature",
  "creatures",
  "player",
  "players",
  "opponent",
  "opponents",
  "card",
  "cards",
  "battlefield",
  "library",
  "hand",
  "mana",
  "add",
  "color",
  "put",
  "beginning",
  "upkeep",
  "step",
  "cost",
  "costs",
  "spell",
  "spells",
  "ability",
  "abilities",
  "damage",
  "deals",
  "gets",
  "gain",
  "gains",
  "loses",
  "lose",
  "life",
  "untap",
  "tap",
  "tapped",
  "untapped",
  "owner",
  "owner's",
  "under",
  "permanent",
  "permanents",
  "other",
  "another",
  "number",
  "equal",
  "choose",
  "activate",
  "only",
  "sorcery",
  "time",
  "times",
  "first",
  "next",
  "draw",
  "enters",
  "shuffle",
  "search",
  "reveal",
  "whenever",
  "when",
  "attacks",
  "attack",
  "dies",
  "leaves",
  "cast",
  "casts",
  "~",
]);

/** The 2–4 word phrases of a text, each once, that could name a mechanic. */
export function phrasesOf(text: string): Set<string> {
  const phrases = new Set<string>();
  // Clauses, not just sentences: "Whenever ~ attacks, the Ring tempts you" is two ideas.
  for (const clause of text.toLowerCase().split(/[.,\n•:;—()"]+/)) {
    const words = clause.split(/\s+/).filter((word) => word !== "");
    for (let length = 2; length <= 4; length++) {
      for (let start = 0; start + length <= words.length; start++) {
        const phrase = words.slice(start, start + length);
        if (STOP_WORDS.has(phrase[0]) || STOP_WORDS.has(phrase[phrase.length - 1])) continue;
        if (phrase.some((word) => /[\d{}]/.test(word))) continue;
        if (phrase.every((word) => STOP_WORDS.has(word) || GENERIC_WORDS.has(word))) continue;
        phrases.add(phrase.join(" "));
      }
    }
  }
  return phrases;
}

// --- Counting ---------------------------------------------------------------------------

type Tally = { finding: SignalFact; cards: string[] };

/**
 * What a group of cards has in common, most cards first. Each card counts once per signal. A
 * recurring phrase is left out when a named signal already explains it ("spore counter") or a
 * longer phrase covers the same cards.
 */
export function countSignals(cards: readonly SignalCard[], options: SignalOptions = {}): Signal[] {
  const minimum = options.minimumCards ?? 3;
  const limit = options.limit ?? 40;

  const named = new Map<string, Tally>();
  const phrases = new Map<string, string[]>();
  for (const card of cards) {
    for (const finding of findingsFor(card)) {
      const key = `${finding.kind}:${finding.name}`;
      const tally = named.get(key) ?? { finding, cards: [] };
      tally.cards.push(card.name);
      named.set(key, tally);
    }
    for (const phrase of phrasesOf(card.faces.map((face) => face.plainText).join("\n"))) {
      let list = phrases.get(phrase);
      if (list === undefined) {
        list = [];
        phrases.set(phrase, list);
      }
      list.push(card.name);
    }
  }

  const namedSignals = [...named.values()]
    .filter((tally) => tally.cards.length >= minimum)
    .map((tally) => toSignal(tally.finding, tally.cards));
  const phraseSignals = recurringPhrases(phrases, minimum)
    .filter(([phrase]) => !explainedBy(namedSignals, phrase))
    .slice(0, MAX_PHRASES)
    .map(([phrase, names]) =>
      toSignal({ kind: "phrase", name: phrase, followUp: oracle(phrase) }, names),
    );

  return [...namedSignals, ...phraseSignals].sort(bySignalStrength).slice(0, limit);
}

/**
 * Whether a named signal already says what the phrase says: the phrase is part of its name
 * ("spore counter"), or has every word of a two-word-or-longer name ("green Saproling creature
 * token" and "Saproling token").
 */
function explainedBy(signals: readonly Signal[], phrase: string): boolean {
  const words = new Set(phrase.split(" "));
  return signals.some((signal) => {
    const name = signal.name.toLowerCase();
    const nameWords = name.split(" ");
    return (
      name.includes(phrase) ||
      (nameWords.length >= 2 && nameWords.every((word) => words.has(word) || words.has(`${word}s`)))
    );
  });
}

/** Phrases on enough cards, longest first among those found on the same cards. */
function recurringPhrases(
  phrases: ReadonlyMap<string, readonly string[]>,
  minimum: number,
): Array<[string, readonly string[]]> {
  const byCount = new Map<number, Array<[string, readonly string[]]>>();
  for (const [phrase, names] of phrases) {
    if (names.length < minimum) continue;
    let bucket = byCount.get(names.length);
    if (bucket === undefined) {
      bucket = [];
      byCount.set(names.length, bucket);
    }
    bucket.push([phrase, names]);
  }

  const kept: Array<[string, readonly string[]]> = [];
  for (const bucket of byCount.values()) {
    bucket.sort(([phraseA], [phraseB]) => phraseB.length - phraseA.length);
    const byWord = new Map<string, string[]>();
    for (const entry of bucket) {
      const [phrase] = entry;
      const words = phrase.split(" ");
      if (isContainedInIndexed(phrase, words, byWord)) continue;
      kept.push(entry);
      for (const word of new Set(words)) {
        let indexed = byWord.get(word);
        if (indexed === undefined) {
          indexed = [];
          byWord.set(word, indexed);
        }
        indexed.push(phrase);
      }
    }
  }

  return kept.sort(
    ([phraseA, namesA], [phraseB, namesB]) =>
      namesB.length - namesA.length ||
      phraseB.length - phraseA.length ||
      phraseA.localeCompare(phraseB),
  );
}

/**
 * Checks whether an already-kept longer phrase in the same count bucket contains `phrase`.
 * For 3+ word phrases, every interior word must appear as a whole word in any containing phrase;
 * for 2-word phrases we check both words so suffix/prefix variants like "token"/"tokens" are caught.
 */
function isContainedInIndexed(
  phrase: string,
  words: readonly string[],
  byWord: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (words.length >= 3) {
    let bestWord = words[1];
    let bestLength = byWord.get(bestWord)?.length ?? 0;
    for (let index = 2; index < words.length - 1; index++) {
      const candidate = words[index];
      const length = byWord.get(candidate)?.length ?? 0;
      if (length < bestLength) {
        bestWord = candidate;
        bestLength = length;
      }
    }
    return (byWord.get(bestWord) ?? []).some((other) => other.includes(phrase));
  }
  return words.some((word) => (byWord.get(word) ?? []).some((other) => other.includes(phrase)));
}

function toSignal(finding: SignalFact, names: readonly string[]): Signal {
  return {
    kind: finding.kind,
    name: finding.name,
    cards: names.length,
    examples: [...new Set(names)].slice(0, EXAMPLES),
    followUp: finding.followUp,
  };
}

/** Most cards first; then in SIGNAL_KINDS order (specific before general); then by name. */
function bySignalStrength(a: Signal, b: Signal): number {
  return (
    b.cards - a.cards ||
    SIGNAL_KINDS.indexOf(a.kind) - SIGNAL_KINDS.indexOf(b.kind) ||
    a.name.localeCompare(b.name)
  );
}

export type SignalLine = DeckCount & Readonly<{ signals?: SignalIO }>;

export type DeckSignalProfile = Readonly<{
  makes: ReadonlyMap<Theme, number>;
  uses: ReadonlyMap<Theme, number>;
}>;

export const NO_SIGNALS: SignalIO = { makes: [], uses: [] };

/** Commander lines contribute 3x weight; main-deck lines contribute 1x. */
const COMMANDER_SIGNAL_WEIGHT = 3;

export function deckSignalProfile(lines: readonly SignalLine[]): DeckSignalProfile {
  const makes = new Map<Theme, number>();
  const uses = new Map<Theme, number>();
  for (const line of lines) {
    if (line.board !== "commander" && line.board !== "main") continue;
    const weight =
      (line.board === "commander" ? COMMANDER_SIGNAL_WEIGHT : 1) * Math.max(1, line.quantity);
    for (const tag of line.signals?.makes ?? []) makes.set(tag, (makes.get(tag) ?? 0) + weight);
    for (const tag of line.signals?.uses ?? []) uses.set(tag, (uses.get(tag) ?? 0) + weight);
  }
  return { makes, uses };
}

export type SynergyMatch = Readonly<{
  tag: Theme;
  direction: "candidateMakes" | "candidateUses";
  deckWeight: number;
  /** Dampened score: Math.sqrt(deckWeight). */
  score: number;
}>;

/** Match candidate's `makes` to deck's `uses` and candidate's `uses` to deck's `makes`. */
export function synergyMatches(
  candidate: SignalIO,
  deck: DeckSignalProfile,
): { total: number; matches: readonly SynergyMatch[] } {
  const matches: SynergyMatch[] = [];
  let total = 0;
  for (const tag of candidate.makes) {
    const deckWeight = deck.uses.get(tag) ?? 0;
    if (deckWeight <= 0) continue;
    const score = Math.sqrt(deckWeight);
    total += score;
    matches.push({ tag, direction: "candidateMakes", deckWeight, score });
  }
  for (const tag of candidate.uses) {
    const deckWeight = deck.makes.get(tag) ?? 0;
    if (deckWeight <= 0) continue;
    const score = Math.sqrt(deckWeight);
    total += score;
    matches.push({ tag, direction: "candidateUses", deckWeight, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return { total, matches };
}
