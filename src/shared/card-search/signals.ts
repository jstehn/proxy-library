// Signals (design doc 28, section 3.7): what a group of cards keeps doing. A Shroofus deck full
// of spore counters and Saprolings says "proliferate" and "token payoffs" even though Shroofus's
// own text says neither. This counts the evidence (counters, tokens, creature types, triggers,
// costs, recurring phrases) and leaves the judgment to whoever reads it, a player or an LLM.
// Pure: the deck builder may use it in the browser later.

import type { Tag, Theme } from "./tags";

/** What the signal rules read about one card. */
export type SignalCard = Readonly<{
  name: string;
  typeLine: string;
  /** Every face's rules text, reminder text included (it's removed here). */
  text: string;
  keywords: readonly string[];
  roleTags: readonly Tag[];
  themes: readonly Theme[];
}>;

export const SIGNAL_KINDS = [
  "counter",
  "token",
  "creatureType",
  "keyword",
  "trigger",
  "cost",
  "zone",
  "cardType",
  "role",
  "theme",
  "phrase",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

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

/** One card's findings: signal key → the signal without its counts. */
type Finding = Readonly<{ kind: SignalKind; name: string; followUp: string }>;

// --- Text -------------------------------------------------------------------------------

/** Rules text without reminder text, with the card's own name (and short name) as "~". */
export function plainText(card: Pick<SignalCard, "name" | "text">): string {
  let text = card.text.replace(/\([^)]*\)/g, "");
  for (const face of card.name.split(" // ")) {
    const shortName = face.split(",")[0];
    for (const name of [face, shortName]) {
      if (name.length >= 3) text = text.split(name).join("~");
    }
  }
  return text;
}

/** Quotes a phrase for the search language, or writes it as a pattern if it has quotes. */
function oracle(phrase: string): string {
  return phrase.includes('"') ? `o:/${phrase.replace(/"/g, ".")}/` : `o:"${phrase}"`;
}

// --- Named signals ----------------------------------------------------------------------

/** Words that can sit before "counter" without naming a kind of counter. */
const NOT_COUNTER_KINDS = new Set([
  "a",
  "an",
  "the",
  "that",
  "those",
  "these",
  "this",
  "its",
  "their",
  "each",
  "any",
  "all",
  "more",
  "additional",
  "of",
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "x",
  "many",
  "and",
  "or",
  "with",
  "kind",
  "same",
  "different",
  "target",
]);

function counterFindings(text: string): Finding[] {
  const findings: Finding[] = [];
  // "counter target spell" is a counterspell, not a counter: only "<kind> counter(s)".
  for (const match of text.matchAll(/(\+1\/\+1|-1\/-1|\b[a-z]+) counters?\b/gi)) {
    const kind = match[1].toLowerCase();
    if (NOT_COUNTER_KINDS.has(kind)) continue;
    const followUp = /^[a-z]+$/.test(kind) ? `o:/${kind} counters?/` : oracle(`${kind} counter`);
    findings.push({ kind: "counter", name: `${kind} counter`, followUp });
  }
  return findings;
}

/** Capitalized words in a token description that aren't the token's name. */
const NOT_TOKEN_NAMES = new Set([
  "Creature",
  "Artifact",
  "Enchantment",
  "Land",
  "Legendary",
  "Snow",
  "Token",
  "X",
]);

function tokenFindings(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(/\bcreates? ([^.]*?)\btokens?\b/gi)) {
    const names = match[1]
      .split(/[\s,]+/)
      .filter((word) => /^[A-Z][a-z]+$/.test(word) && !NOT_TOKEN_NAMES.has(word));
    for (const name of new Set(names)) {
      findings.push({
        kind: "token",
        name: `${name} token`,
        followUp: `o:/create[^.]*${name.toLowerCase()}/`,
      });
    }
  }
  return findings;
}

function creatureTypeFindings(typeLine: string): Finding[] {
  const findings: Finding[] = [];
  for (const face of typeLine.split(" // ")) {
    const [types, subtypes] = face.split(" — ");
    if (subtypes === undefined || !/\b(Creature|Kindred|Tribal)\b/.test(types)) continue;
    for (const subtype of subtypes.split(" ")) {
      if (subtype === "") continue;
      findings.push({
        kind: "creatureType",
        name: subtype,
        followUp: `t:${subtype.toLowerCase()}`,
      });
    }
  }
  return findings;
}

type TextRule = Readonly<{ kind: SignalKind; name: string; pattern: RegExp; followUp: string }>;

/** Triggers, costs and zones: one pattern each, and a search that finds more of the same. */
const TEXT_RULES: readonly TextRule[] = [
  rule("trigger", "dies trigger", String.raw`\bwhen(ever)? [^.]*\bdies\b`),
  rule("trigger", "enters trigger", String.raw`\bwhen(ever)? [^.]*\benters\b`),
  rule("trigger", "attack trigger", String.raw`\bwhenever [^.]*\battacks\b`),
  rule("trigger", "leaves trigger", String.raw`\bwhen(ever)? [^.]*\bleaves the battlefield\b`),
  rule("trigger", "cast trigger", String.raw`\bwhenever you cast\b`),
  rule("trigger", "draw trigger", String.raw`\bwhenever you draw\b`),
  rule("trigger", "landfall", String.raw`\blandfall\b|\bwhenever a land( you control)? enters\b`),
  rule("trigger", "sacrifice trigger", String.raw`\bwhenever you sacrifice\b`),
  rule("trigger", "lifegain trigger", String.raw`\bwhenever you gain life\b`),
  rule("trigger", "counter placed trigger", String.raw`\bwhenever [^.]*\bcounters? (is|are) put\b`),
  rule("trigger", "token trigger", String.raw`\bwhenever [^.]*\btokens? [^.]*\benters?\b`),
  rule("trigger", "combat damage trigger", String.raw`\bdeals combat damage to a player\b`),
  rule("cost", "sacrifice a creature", String.raw`\bsacrifice (a|an|another) [^.:]*creature\b`),
  rule("cost", "sacrifice an artifact", String.raw`\bsacrifice (a|an|another) [^.:]*artifact\b`),
  rule("cost", "sacrifice a land", String.raw`\bsacrifice (a|an|another) [^.:]*land\b`),
  rule("cost", "remove counters", String.raw`\bremove [^.:]*\bcounters? from\b`),
  rule("cost", "pay life", String.raw`\bpay \d+ life\b`),
  rule("cost", "discard a card", String.raw`\bdiscard (a|an|one|two) [^.]*cards?\b`),
  rule("cost", "tap untapped creatures", String.raw`\btap [^.:]*untapped [^.:]*creatures?\b`),
  rule("zone", "graveyard", String.raw`\bgraveyards?\b`),
  rule("zone", "exile", String.raw`\bexiles?\b`),
  rule("zone", "top of library", String.raw`\btop of your library\b`),
  rule(
    "zone",
    "cast from elsewhere",
    String.raw`\bcast [^.]*\bfrom (your graveyard|exile|the top)\b`,
  ),
  rule("zone", "mill", String.raw`\bmills?\b`),
];

/**
 * A text rule. The follow-up search drops `\b`: in Postgres's regular expressions it means a
 * backspace, not a word boundary.
 */
function rule(kind: SignalKind, name: string, source: string): TextRule {
  const followUp = `o:/${source.replace(/\\b/g, "")}/`;
  return { kind, name, pattern: new RegExp(source, "i"), followUp };
}

/** Card types worth counting: a deck with many of one says "artifacts matter" and the like. */
const CARD_TYPES: ReadonlyArray<Readonly<{ name: string; pattern: RegExp; followUp: string }>> = [
  { name: "artifacts", pattern: /\bArtifact\b/, followUp: "t:artifact" },
  { name: "enchantments", pattern: /\bEnchantment\b/, followUp: "t:enchantment" },
  {
    name: "instants and sorceries",
    pattern: /\b(Instant|Sorcery)\b/,
    followUp: "(t:instant or t:sorcery)",
  },
  { name: "planeswalkers", pattern: /\bPlaneswalker\b/, followUp: "t:planeswalker" },
  { name: "Equipment", pattern: /\bEquipment\b/, followUp: "t:equipment" },
  { name: "Auras", pattern: /\bAura\b/, followUp: "t:aura" },
  { name: "legendaries", pattern: /\bLegendary\b/, followUp: "is:legendary" },
];

/** Everything one card shows, each signal once. */
function findingsFor(card: SignalCard): Finding[] {
  const text = plainText(card);
  const findings: Finding[] = [
    ...counterFindings(text),
    ...tokenFindings(text),
    ...creatureTypeFindings(card.typeLine),
    ...card.keywords.map((keyword) => ({
      kind: "keyword" as const,
      name: keyword,
      followUp: `kw:"${keyword.toLowerCase()}"`,
    })),
    ...TEXT_RULES.filter((row) => row.pattern.test(text)),
    ...CARD_TYPES.filter((row) => row.pattern.test(card.typeLine)).map((row) => ({
      kind: "cardType" as const,
      name: row.name,
      followUp: row.followUp,
    })),
    ...card.roleTags.map((tag) => ({ kind: "role" as const, name: tag, followUp: `tag:${tag}` })),
    ...card.themes.map((theme) => ({
      kind: "theme" as const,
      name: theme,
      followUp: `theme:${theme}`,
    })),
  ];
  const unique = new Map<string, Finding>();
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

type Tally = { finding: Finding; cards: string[] };

/**
 * What a group of cards has in common, most cards first. Each card counts once per signal. A
 * recurring phrase is left out when a named signal already explains it ("spore counter") or a
 * longer phrase covers the same cards.
 */
export function cardSignals(cards: readonly SignalCard[], options: SignalOptions = {}): Signal[] {
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
    for (const phrase of phrasesOf(plainText(card))) {
      phrases.set(phrase, [...(phrases.get(phrase) ?? []), card.name]);
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
  const frequent = [...phrases].filter(([, names]) => names.length >= minimum);
  const kept = frequent.filter(
    ([phrase, names]) =>
      !frequent.some(
        ([other, otherNames]) =>
          other !== phrase && other.includes(phrase) && otherNames.length === names.length,
      ),
  );
  return kept.sort(
    ([phraseA, namesA], [phraseB, namesB]) =>
      namesB.length - namesA.length ||
      phraseB.length - phraseA.length ||
      phraseA.localeCompare(phraseB),
  );
}

function toSignal(finding: Finding, names: readonly string[]): Signal {
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
