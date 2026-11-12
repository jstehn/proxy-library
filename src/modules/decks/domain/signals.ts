import { plainText } from "@/shared/card-search";
import type { Board } from "./boards";

// Produces/consumes synergy signals (design doc 46, #54): regex rules over oracle text
// (reminder text stripped) that tag what resources/triggers a card makes and uses.
// Matching candidate `makes` to deck `uses` (and vice versa) finds complements, not just clones.

export const SIGNAL_TAGS = [
  "treasure",
  "token",
  "sacrifice",
  "plus_one_counter",
  "graveyard",
  "lifegain",
  "landfall_ramp",
  "spellslinger",
  "blink_etb",
  "artifact_synergy",
  "enchantment_synergy",
  "draw_discard",
] as const;

export type SignalTag = (typeof SIGNAL_TAGS)[number];

export const SIGNAL_LABELS: Readonly<Record<SignalTag, string>> = {
  treasure: "Treasure",
  token: "tokens",
  sacrifice: "sacrifice",
  plus_one_counter: "+1/+1 counters",
  graveyard: "graveyard",
  lifegain: "lifegain",
  landfall_ramp: "landfall",
  spellslinger: "spellslinger",
  blink_etb: "blink / ETB",
  artifact_synergy: "artifacts",
  enchantment_synergy: "enchantments",
  draw_discard: "draw / discard",
};

export type SignalCardInput = Readonly<{
  name: string;
  typeLine: string;
  text: string;
  manaValue?: number;
}>;

export type SignalIO = Readonly<{
  makes: readonly SignalTag[];
  uses: readonly SignalTag[];
}>;

type SignalRule = Readonly<{
  tag: SignalTag;
  makesPatterns: readonly RegExp[];
  usesPatterns: readonly RegExp[];
  makesCard?: (card: SignalCardInput) => boolean;
  usesCard?: (card: SignalCardInput) => boolean;
}>;

const r = (source: string) => new RegExp(source, "i");

const SIGNAL_RULES: readonly SignalRule[] = [
  {
    tag: "treasure",
    makesPatterns: [r(String.raw`\bcreates? [^.]*\btreasure tokens?\b`)],
    usesPatterns: [
      r(String.raw`\bwhenever [^.]*\btreasure\b`),
      r(String.raw`\bwhenever [^.]*\bsacrifices? an? (artifact|permanent)\b`),
      r(String.raw`\b(artifact|treasure)s? you control\b[^.]*\b(deal|gain|draw|get|cost)\b`),
    ],
  },
  {
    tag: "token",
    makesPatterns: [r(String.raw`\bcreates? [^.]*\btokens?\b`)],
    usesPatterns: [
      r(String.raw`\b(creature )?tokens? you control\b`),
      r(String.raw`\bwhenever (a|one or more) tokens?\b`),
      r(String.raw`\bfor each (creature )?token\b`),
      r(String.raw`\bpopulate\b`),
    ],
  },
  {
    tag: "sacrifice",
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
    tag: "plus_one_counter",
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
    tag: "graveyard",
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
    tag: "lifegain",
    makesPatterns: [r(String.raw`\bgains? [^.]*\blife\b`), r(String.raw`\blifelink\b`)],
    usesPatterns: [
      r(String.raw`\bwhenever you gain life\b`),
      r(String.raw`\bif you gained life\b`),
      r(String.raw`\bpay [^.]* life\b`),
    ],
  },
  {
    tag: "landfall_ramp",
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
    tag: "spellslinger",
    makesCard: (card) => /\b(Instant|Sorcery)\b/.test(card.typeLine) && (card.manaValue ?? 99) <= 3,
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
    tag: "blink_etb",
    makesPatterns: [
      r(String.raw`\bexile [^.]* then return (it|that card|them) to the battlefield\b`),
    ],
    usesPatterns: [
      r(String.raw`\bwhen ~ enters\b[^.]*\b(draw|create|destroy|exile|search|gain|return)\b`),
      r(String.raw`\bwhenever [^.]* enters[^.]*\b(draw|create|destroy|exile|search|gain|return)\b`),
    ],
  },
  {
    tag: "artifact_synergy",
    makesCard: (card) => /\bArtifact\b/.test(card.typeLine) && (card.manaValue ?? 99) <= 3,
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
    tag: "enchantment_synergy",
    makesCard: (card) => /\bEnchantment\b/.test(card.typeLine) && (card.manaValue ?? 99) <= 4,
    makesPatterns: [],
    usesPatterns: [
      r(String.raw`\bconstellation\b`),
      r(String.raw`\bwhenever an? enchantment enters\b`),
      r(String.raw`\bwhenever you cast an? enchantment\b`),
      r(String.raw`\bfor each enchantment you control\b`),
    ],
  },
  {
    tag: "draw_discard",
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

/** Pure produces/consumes signal extraction for a single card (reminder text stripped). */
export function cardSignalIO(card: SignalCardInput): SignalIO {
  const text = plainText(card);
  const makes: SignalTag[] = [];
  const uses: SignalTag[] = [];
  for (const rule of SIGNAL_RULES) {
    if (
      (rule.makesCard !== undefined && rule.makesCard(card)) ||
      rule.makesPatterns.some((pattern) => pattern.test(text))
    ) {
      makes.push(rule.tag);
    }
    if (
      (rule.usesCard !== undefined && rule.usesCard(card)) ||
      rule.usesPatterns.some((pattern) => pattern.test(text))
    ) {
      uses.push(rule.tag);
    }
  }
  return { makes, uses };
}

export type SignalLine = SignalCardInput & Readonly<{ board: Board; quantity: number }>;

export type DeckSignalProfile = Readonly<{
  makes: ReadonlyMap<SignalTag, number>;
  uses: ReadonlyMap<SignalTag, number>;
}>;

/** Commander lines contribute 3x weight; main-deck lines contribute 1x. */
const COMMANDER_SIGNAL_WEIGHT = 3;

export function deckSignalProfile(lines: readonly SignalLine[]): DeckSignalProfile {
  const makes = new Map<SignalTag, number>();
  const uses = new Map<SignalTag, number>();
  for (const line of lines) {
    if (line.board !== "commander" && line.board !== "main") continue;
    const weight =
      (line.board === "commander" ? COMMANDER_SIGNAL_WEIGHT : 1) * Math.max(1, line.quantity);
    const io = cardSignalIO(line);
    for (const tag of io.makes) makes.set(tag, (makes.get(tag) ?? 0) + weight);
    for (const tag of io.uses) uses.set(tag, (uses.get(tag) ?? 0) + weight);
  }
  return { makes, uses };
}

export type SynergyMatch = Readonly<{
  tag: SignalTag;
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
