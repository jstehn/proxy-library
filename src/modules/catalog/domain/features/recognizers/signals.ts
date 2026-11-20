// Signals (design docs 28, 46 and 66): what a card shows, for the deck-level counting in
// decks/domain/signals.ts. Two kinds of facts. Evidence (`signals`): counters, tokens, creature
// types, keywords, triggers, costs, zones and card types a card's text mentions. Themes it makes
// or uses (`makes`, `uses`): "a Treasure maker makes treasures, a sacrifice payoff uses them".
// Moved from shared/card-search/signals.ts and decks/domain/signals.ts, where the second kind had
// twelve names of its own; themes are now the one vocabulary. `plain-faces` keeps each face's plain
// text for the recurring-phrase search.
import { hasTypeWord, plainText, type SignalKind, type Theme } from "@/shared/kernel";
import type { CardText, Recognizer, SignalFact } from "../types";

const r = (source: string) => new RegExp(source, "i");

/** Quotes a phrase for the search language, or writes it as a pattern if it has quotes. */
function oracle(phrase: string): string {
  return phrase.includes('"') ? `o:/${phrase.replace(/"/g, ".")}/` : `o:"${phrase}"`;
}

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

function counterFindings(text: string): SignalFact[] {
  const findings: SignalFact[] = [];
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

function tokenFindings(text: string): SignalFact[] {
  const findings: SignalFact[] = [];
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

function creatureTypeFindings(typeLine: string): SignalFact[] {
  const findings: SignalFact[] = [];
  for (const face of typeLine.split(" // ")) {
    const [types, subtypes] = face.split(" — ");
    if (subtypes === undefined || !hasTypeWord(types, ["Creature", "Kindred", "Tribal"])) continue;
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
  rule("trigger", "each opponent", String.raw`\beach opponent\b`),
  rule("trigger", "goad", String.raw`\bgoad(s|ed)?\b`),
  rule("trigger", "monarch", String.raw`\bthe monarch\b`),
  rule(
    "trigger",
    "blink",
    String.raw`\bexiles? [^.]*?\breturn (that card|it|them|those cards) to the battlefield\b`,
  ),
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

/** A text rule; its follow-up search is the same pattern (the search reads `\b` as here). */
function rule(kind: SignalKind, name: string, source: string): TextRule {
  return { kind, name, pattern: new RegExp(source, "i"), followUp: `o:/${source}/` };
}

/** Card types worth counting: a deck with many of one says "artifacts matter" and the like. */
const CARD_TYPES: ReadonlyArray<
  Readonly<{ name: string; words: readonly string[]; followUp: string }>
> = [
  { name: "artifacts", words: ["Artifact"], followUp: "t:artifact" },
  { name: "enchantments", words: ["Enchantment"], followUp: "t:enchantment" },
  {
    name: "instants and sorceries",
    words: ["Instant", "Sorcery"],
    followUp: "(t:instant or t:sorcery)",
  },
  { name: "planeswalkers", words: ["Planeswalker"], followUp: "t:planeswalker" },
  { name: "Equipment", words: ["Equipment"], followUp: "t:equipment" },
  { name: "Auras", words: ["Aura"], followUp: "t:aura" },
  { name: "legendaries", words: ["Legendary"], followUp: "is:legendary" },
];

type MakesUsesRule = Readonly<{
  theme: Theme;
  makesPatterns: readonly RegExp[];
  usesPatterns: readonly RegExp[];
  makesCard?: (typeLine: string, manaValue: number) => boolean;
  usesCard?: (typeLine: string, manaValue: number) => boolean;
}>;

const MAKES_USES_RULES: readonly MakesUsesRule[] = [
  {
    theme: "treasures",
    makesPatterns: [r(String.raw`\bcreates? [^.]*\btreasure tokens?\b`)],
    usesPatterns: [
      r(String.raw`\bwhenever [^.]*\btreasure\b`),
      r(String.raw`\bwhenever [^.]*\bsacrifices? an? (artifact|permanent)\b`),
      r(String.raw`\b(artifact|treasure)s? you control\b[^.]*\b(deal|gain|draw|get|cost)\b`),
    ],
  },
  {
    theme: "tokens",
    makesPatterns: [r(String.raw`\bcreates? [^.]*\btokens?\b`)],
    usesPatterns: [
      r(String.raw`\b(creature )?tokens? you control\b`),
      r(String.raw`\bwhenever (a|one or more) tokens?\b`),
      r(String.raw`\bfor each (creature )?token\b`),
      r(String.raw`\bpopulate\b`),
    ],
  },
  {
    theme: "sacrifice",
    makesPatterns: [
      r(String.raw`\bsacrifice (a|an|another|one or more|\d+) (creature|artifact|permanent|token)`),
      r(String.raw`\beach player sacrifices\b`),
    ],
    usesPatterns: [
      r(
        String.raw`\bwhenever (a|another) (creature|artifact|permanent)[^.]*?\b(dies|is sacrificed|is put into a graveyard)\b`,
      ),
      r(String.raw`\bwhenever (you|a player) sacrifices?\b`),
    ],
  },
  {
    theme: "counters",
    makesPatterns: [
      r(String.raw`\bputs? (a|an|one|two|three|four|x|\d+) \+1/\+1 counters?\b`),
      r(String.raw`\benters[^.]*with (a|an|x|\d+) \+1/\+1 counters?\b`),
      r(String.raw`\bproliferate\b`),
    ],
    usesPatterns: [
      r(String.raw`\bmodified\b`),
      r(String.raw`\b\+1/\+1 counter\b[^.]*\b(whenever|for each|doubled|twice|additional)\b`),
      r(String.raw`\bremove a \+1/\+1 counter\b`),
      r(String.raw`\bproliferate\b`),
    ],
  },
  {
    theme: "graveyard",
    makesPatterns: [
      r(String.raw`\bmill(s|ed)?\b`),
      r(String.raw`\bdiscard(s|ed)?\b`),
      r(String.raw`\bput [^.]* into your graveyard\b`),
      r(String.raw`\bsurveil\b`),
    ],
    usesPatterns: [
      r(String.raw`\bfrom your graveyard\b`),
      r(String.raw`\b(flashback|delve|escape|encore|unearth|dredge)\b`),
      r(String.raw`\bfor each [^.]* card in your graveyard\b`),
      r(String.raw`\bwhenever a [^.]* card is put into your graveyard\b`),
    ],
  },
  {
    theme: "lifegain",
    makesPatterns: [r(String.raw`\bgains? [^.]*\blife\b`), r(String.raw`\blifelink\b`)],
    usesPatterns: [
      r(String.raw`\bwhenever you gain life\b`),
      r(String.raw`\bif you gained life\b`),
      r(String.raw`\bpay [^.]* life\b`),
    ],
  },
  {
    theme: "landfall",
    makesPatterns: [
      r(
        String.raw`\bsearch your library for [^.]*\b(land|forest|plains|island|swamp|mountain|basic)s?\b[^.]*battlefield`,
      ),
      r(String.raw`\bplay (an|two|\w+) additional lands?\b`),
      r(String.raw`\bput [^.]* land cards? [^.]* onto the battlefield\b`),
    ],
    usesPatterns: [
      r(String.raw`\blandfall\b`),
      r(String.raw`\bwhenever a land enters\b`),
      r(String.raw`\bfor each land you control\b`),
    ],
  },
  {
    theme: "spells",
    makesCard: (typeLine, manaValue) =>
      hasTypeWord(typeLine, ["Instant", "Sorcery"]) && manaValue <= 3,
    makesPatterns: [
      r(String.raw`\bcopy target (instant|sorcery)\b`),
      r(String.raw`\b(storm|rebound)\b`),
    ],
    usesPatterns: [
      r(String.raw`\bwhenever you cast (an instant|a sorcery|a noncreature|your second)\b`),
      r(String.raw`\b(magecraft|prowess)\b`),
    ],
  },
  {
    theme: "blink",
    makesPatterns: [
      r(String.raw`\bexile [^.]* then return (it|that card|them) to the battlefield\b`),
    ],
    usesPatterns: [
      r(String.raw`\bwhen ~ enters\b[^.]*\b(draw|create|destroy|exile|search|gain|return)\b`),
      r(String.raw`\bwhenever [^.]* enters[^.]*\b(draw|create|destroy|exile|search|gain|return)\b`),
    ],
  },
  {
    theme: "artifacts",
    makesCard: (typeLine, manaValue) => hasTypeWord(typeLine, ["Artifact"]) && manaValue <= 3,
    makesPatterns: [
      r(
        String.raw`\bcreates? [^.]*\b(treasure|clue|food|blood|thopter|servo|powerstone|map) tokens?\b`,
      ),
    ],
    usesPatterns: [
      r(String.raw`\b(affinity for artifacts|improvise|metalcraft)\b`),
      r(String.raw`\bwhenever an? artifact enters\b`),
      r(String.raw`\bfor each artifact you control\b`),
      r(String.raw`\bartifacts? you control (get|have)\b`),
    ],
  },
  {
    theme: "enchantments",
    makesCard: (typeLine, manaValue) => hasTypeWord(typeLine, ["Enchantment"]) && manaValue <= 4,
    makesPatterns: [],
    usesPatterns: [
      r(String.raw`\bconstellation\b`),
      r(String.raw`\bwhenever an? enchantment enters\b`),
      r(String.raw`\bwhenever you cast an? enchantment\b`),
      r(String.raw`\bfor each enchantment you control\b`),
    ],
  },
  {
    theme: "wheels",
    makesPatterns: [
      r(String.raw`\bdraws? (two|three|four|five|six|seven|x|\d+) cards?\b`),
      r(String.raw`\beach player discards\b`),
      r(String.raw`\bdiscard your hand\b`),
    ],
    usesPatterns: [
      r(String.raw`\bwhenever you draw\b`),
      r(String.raw`\bwhenever you discard\b`),
      r(String.raw`\bwhenever an opponent (draws|discards)\b`),
    ],
  },
];

/** Every face's rules text, plain, with the card's own names as "~". */
const plainFacesOf = (card: CardText) => {
  const names = card.faces.map((face) => face.name);
  return card.faces.map((face) => plainText(face.text, names));
};

const typeLineOf = (card: CardText) => card.faces.map((face) => face.typeLine).join(" // ");

/** What the card's text, types and keywords show. */
export const signals: Recognizer<"signals"> = {
  id: "signals",
  field: "signals",
  recognize(card) {
    const typeLine = typeLineOf(card);
    const texts = plainFacesOf(card);
    const facts: SignalFact[] = [
      ...texts.flatMap((text) => [...counterFindings(text), ...tokenFindings(text)]),
      ...creatureTypeFindings(typeLine),
      ...card.keywords.map((keyword) => ({
        kind: "keyword" as const,
        name: keyword,
        followUp: `kw:"${keyword.toLowerCase()}"`,
      })),
      ...texts.flatMap((text) =>
        TEXT_RULES.filter((row) => row.pattern.test(text)).map(({ kind, name, followUp }) => ({
          kind,
          name,
          followUp,
        })),
      ),
      ...CARD_TYPES.filter((row) => hasTypeWord(typeLine, row.words)).map((row) => ({
        kind: "cardType" as const,
        name: row.name,
        followUp: row.followUp,
      })),
    ];
    const unique = new Map<string, SignalFact>();
    for (const fact of facts) unique.set(`${fact.kind}:${fact.name}`, fact);
    return [...unique.values()];
  },
};

/** The themes the text makes (`direction` "makes") or uses (`direction` "uses"). */
function themesOf(card: CardText, direction: "makes" | "uses"): Theme[] {
  const typeLine = typeLineOf(card);
  const texts = plainFacesOf(card);
  return MAKES_USES_RULES.filter((rule) => {
    const byCard = direction === "makes" ? rule.makesCard : rule.usesCard;
    const patterns = direction === "makes" ? rule.makesPatterns : rule.usesPatterns;
    return (
      byCard?.(typeLine, card.manaValue) === true ||
      texts.some((text) => patterns.some((pattern) => pattern.test(text)))
    );
  }).map((rule) => rule.theme);
}

export const signalIO: Recognizer<"signalIO"> = {
  id: "signal-io",
  field: "signalIO",
  recognize: (card) => ({ makes: themesOf(card, "makes"), uses: themesOf(card, "uses") }),
};

export const faces: Recognizer<"faces"> = {
  id: "plain-faces",
  field: "faces",
  recognize: (card) => plainFacesOf(card).map((plain) => ({ plainText: plain })),
};
