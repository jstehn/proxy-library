// Themes (design docs 20 and 38): what a deck builds around. A theme has two sides: what a
// commander says when it leads one ("sacrifice another creature"), and what a card says when it
// plays into one ("when this dies"). Umbrella themes (tokens, artifact-tokens, politics) overlap
// with their sub-themes so specific matches score higher while broad searches still find all of them.
// Moved from shared/card-search/tags.ts.
import { hasTypeWord, plainText, type Theme } from "@/shared/mtg";
import type { CardText, Recognizer } from "../types";
import { grantedKeywords } from "./grants";

type ThemeRule = Readonly<{
  theme: Theme;
  /** A commander leads this theme if its text matches one of these. */
  leads: readonly RegExp[];
  /** A card plays into this theme. */
  fits: (typeLine: string, text: string) => boolean;
}>;

const rule = (source: string) => new RegExp(source, "i");

const matchesAny = (patterns: readonly RegExp[], text: string) =>
  patterns.some((pattern) => pattern.test(text));
const frontFaceHas = (typeLine: string, typeWords: readonly string[]) =>
  hasTypeWord(typeLine, typeWords, true);

const COUNTERS = [rule(String.raw`\+1/\+1 counters?\b`), rule(String.raw`\bproliferate\b`)];
const LIFEGAIN = [rule(String.raw`\byou gain [^.]*\blife\b`), rule(String.raw`\blifelink\b`)];

// Token hierarchy: treasures / food / clues ⊂ artifact-tokens ⊂ tokens, and creature-tokens ⊂ tokens.
const TREASURES = [
  rule(String.raw`\bcreates? [^.]*\btreasure tokens?\b`),
  rule(String.raw`\btreasures? you control\b`),
  rule(String.raw`\b(whenever|for each) [^.]*\btreasures?\b`),
  rule(String.raw`\bsacrifices? [^.:]*\btreasures?\b`),
];
const FOOD = [
  rule(String.raw`\bcreates? [^.]*\bfood tokens?\b`),
  rule(String.raw`\bfoods? you control\b`),
  rule(String.raw`\b(whenever|for each) [^.]*\bfoods?\b`),
  rule(String.raw`\bsacrifices? [^.:]*\bfoods?\b`),
];
const CLUES = [
  rule(String.raw`\bcreates? [^.]*\bclue tokens?\b`),
  rule(String.raw`\binvestigates?\b`),
  rule(String.raw`\bclues? you control\b`),
  rule(String.raw`\b(whenever|for each) [^.]*\bclues?\b`),
  rule(String.raw`\bsacrifices? [^.:]*\bclues?\b`),
];
const ARTIFACT_TOKENS = [
  ...TREASURES,
  ...FOOD,
  ...CLUES,
  rule(
    String.raw`\bcreates? [^.]*\b(artifact|blood|junk|map|powerstone|gold|shard|lander|thopter|servo|myr|construct|incubator) (creature )?tokens?\b`,
  ),
  rule(String.raw`\bincubates?\b`),
  rule(String.raw`\bartifact tokens? you control\b`),
];
const CREATURE_TOKENS = [
  rule(String.raw`\bcreates? [^.]*\bcreature tokens?\b`),
  rule(String.raw`\bcreature tokens? you control\b`),
  rule(
    String.raw`\b(populate|amass|offspring|squad|mobilize|fabricate|living weapon|for mirrodin!)\b`,
  ),
];
const TOKENS = [
  rule(String.raw`\bcreates? [^.]*\btokens?\b`),
  rule(String.raw`\btokens? you control\b`),
  rule(String.raw`\btwice that many of those tokens\b`),
  ...CREATURE_TOKENS,
  ...ARTIFACT_TOKENS,
];

// Politics hierarchy: goad / voting / group-hug / monarch ⊂ politics.
const GOAD = [rule(String.raw`\bgoad(s|ed)?\b`)];
const VOTING = [
  rule(String.raw`\b(votes?|voting|will of the council|council's dilemma|secret council)\b`),
];
const GROUP_HUG = [
  rule(String.raw`\b(tempting offer|join forces|demonstrate)\b`),
  rule(String.raw`\beach (other )?player (draws?|may\b|gains?\b|puts?\b|scries\b)`),
  rule(String.raw`\btarget opponent (draws?|gains?|may\b|creates?)`),
];
const MONARCH = [
  rule(
    String.raw`\b(the monarch|become the monarch|take the initiative|venture into the dungeon)\b`,
  ),
];
const POLITICS = [
  ...GOAD,
  ...VOTING,
  ...GROUP_HUG,
  ...MONARCH,
  rule(String.raw`\b(choose an opponent|an opponent of your choice|secretly choose)\b`),
  rule(String.raw`\bunless (that player|an opponent|any player) pays\b`),
  rule(String.raw`\bcan't attack you( or planeswalkers you control)?\b`),
  rule(String.raw`\bwhenever a creature attacks one of your opponents\b`),
];

const EACH_OPPONENT_LEADS = [
  rule(String.raw`\beach opponent\b`),
  rule(String.raw`\bfor each opponent\b`),
  rule(String.raw`\bnumber of opponents\b`),
  rule(String.raw`\bwhenever an opponent\b`),
  rule(String.raw`\bdeals? combat damage to one or more of your opponents\b`),
];
const EACH_OPPONENT_FITS = [
  rule(String.raw`\beach opponent\b`),
  rule(String.raw`\bfor each opponent\b`),
];

const BLINK_LEADS = [
  rule(
    String.raw`\bexiles? (up to \w+ )?(another )?target [^.]*?\breturn (that card|it|them|those cards) to the battlefield\b`,
  ),
  rule(
    String.raw`\bexiles? [^.]*?\bthen return (that card|it|them|those cards) to the battlefield\b`,
  ),
  rule(
    String.raw`\bexiles? [^.]*?\breturn (that card|it|them|those cards) to the battlefield under (its|their) owner's control at the beginning of the next end step\b`,
  ),
  rule(String.raw`\bif a (permanent|creature|artifact) entering causes a triggered ability\b`),
];

const WHEELS_LEADS = [
  rule(String.raw`\beach player discards\b`),
  rule(String.raw`\bwhenever (you|an opponent|a player) discards?\b`),
  rule(String.raw`\bdiscard(s|ed)? [^.]*\bcards?\b`),
  rule(String.raw`\bconnives?\b`),
];
const WHEELS_FITS = [...WHEELS_LEADS, rule(String.raw`\b(madness|cycling)\b`)];

const CLONES = [
  rule(String.raw`\b(becomes?|enter(s)? as) a copy of\b`),
  rule(String.raw`(?<!for each [^.]*token you control, )\bcreates? a token that's a copy of\b`),
  rule(
    String.raw`\bcop(y|ies) target (instant|sorcery|spell|creature|permanent|artifact|enchantment|activated|triggered)\b`,
  ),
  rule(String.raw`\bwhenever you (cast or )?copy\b`),
  rule(String.raw`\b(offspring|replicate|storm|casualty)\b`),
];

const THEFT = [
  rule(
    String.raw`\bgains? control of target (creature|artifact|permanent|spell|nonland permanent)\b`,
  ),
  rule(String.raw`\bexiles? [^.]*\bfrom (target|an|each) opponent's library\b`),
  rule(String.raw`\b(target|an|each) opponent's library\b[^.]*\bexiles?\b`),
  rule(
    String.raw`\bput [^.]*\bfrom (an|target|each) opponent's graveyard onto the battlefield under your control\b`,
  ),
  rule(
    String.raw`\b(spells? you cast|permanents? you control) (that )?you don't own\b|\bbut don't own\b`,
  ),
];

const PLANESWALKERS_LEADS = [
  rule(String.raw`\bplaneswalkers? you control\b`),
  rule(String.raw`\bloyalty (abilities|counters?)\b`),
];

const LEGENDS = [
  rule(String.raw`\blegendary (creatures?|permanents?|spells?|cards?)\b`),
  rule(String.raw`\bhistoric (permanents?|spells?|cards?)\b`),
];

const EXILE = [
  rule(String.raw`\b(play|cast) [^.]*\bfrom (exile|anywhere other than your hand)\b`),
  rule(String.raw`\bexiles? the top [^.]*\blibrary\b[\s\S]*?\bmay (play|cast)\b`),
  rule(String.raw`\bexiles? [^.]*\b(you may|until[^.]*may) (play|cast)\b`),
  rule(String.raw`\b(cascade|discover|foretell|plot|suspend|airbend)\b`),
];

const EXTRA_COMBAT = [
  rule(String.raw`\badditional combat phases?\b`),
  rule(String.raw`\bwhenever [^.]*\battacks, [^.]*\btriggers an additional time\b`),
];

const STAX = [
  rule(String.raw`\bspells? [^.]*?\bcost \{[^}]+\} more to cast\b`),
  rule(String.raw`\bcan't cast more than one spell\b`),
  rule(String.raw`\bplayers can't search libraries\b`),
  rule(String.raw`\bdon't untap during (their|your) (controllers' )?untap steps?\b`),
  rule(String.raw`\bopponents control enter tapped\b`),
];

const POISON = [rule(String.raw`\b(poison counters?|infect|toxic|corrupted)\b`)];

const VEHICLES = [
  rule(String.raw`\b(vehicles?|mounts?|spacecrafts?)\b`),
  rule(String.raw`\b(crew|saddle) \d+\b`),
];

const THEME_RULES: readonly ThemeRule[] = [
  {
    theme: "counters",
    leads: COUNTERS,
    fits: (_typeLine, text) => matchesAny(COUNTERS, text),
  },
  {
    theme: "tokens",
    leads: [...TOKENS, rule(String.raw`\bwhenever [^.]*\btokens? [^.]*\benters?\b`)],
    fits: (_typeLine, text) => matchesAny(TOKENS, text),
  },
  {
    theme: "creature-tokens",
    leads: CREATURE_TOKENS,
    fits: (_typeLine, text) => matchesAny(CREATURE_TOKENS, text),
  },
  {
    theme: "artifact-tokens",
    leads: ARTIFACT_TOKENS,
    fits: (typeLine, text) =>
      matchesAny(ARTIFACT_TOKENS, text) || frontFaceHas(typeLine, ["Treasure", "Food", "Clue"]),
  },
  {
    theme: "treasures",
    leads: TREASURES,
    fits: (typeLine, text) => matchesAny(TREASURES, text) || frontFaceHas(typeLine, ["Treasure"]),
  },
  {
    theme: "food",
    leads: FOOD,
    fits: (typeLine, text) => matchesAny(FOOD, text) || frontFaceHas(typeLine, ["Food"]),
  },
  {
    theme: "clues",
    leads: CLUES,
    fits: (typeLine, text) => matchesAny(CLUES, text) || frontFaceHas(typeLine, ["Clue"]),
  },
  {
    theme: "sacrifice",
    leads: [
      rule(
        String.raw`\bsacrifices? (a|an|another|one or more|x|\w+) (other )?(creatures?|artifacts?|permanents?)\b`,
      ),
      rule(String.raw`\bwhenever (a|another|one or more) [^.]*creatures? [^.]*\bdies?\b`),
    ],
    fits: (_typeLine, text) => /\bsacrifice\b|\bdies\b/i.test(text),
  },
  {
    theme: "graveyard",
    leads: [rule(String.raw`\b(from|in) your graveyard\b`), rule(String.raw`\bmills?\b`)],
    fits: (_typeLine, text) =>
      /\bgraveyard\b|\bmills?\b|\bsurveil\b|\b(flashback|unearth|escape|embalm|eternalize|encore|dredge)\b/i.test(
        text,
      ),
  },
  {
    theme: "artifacts",
    leads: [rule(String.raw`\b(whenever|for each|number of) [^.]*\bartifacts?\b`)],
    fits: (typeLine) => frontFaceHas(typeLine, ["Artifact"]),
  },
  {
    theme: "enchantments",
    leads: [rule(String.raw`\b(whenever|for each|number of) [^.]*\benchantments?\b`)],
    fits: (typeLine) => frontFaceHas(typeLine, ["Enchantment"]),
  },
  {
    theme: "lifegain",
    leads: [rule(String.raw`\bwhenever you gain life\b`), rule(String.raw`\bgained life\b`)],
    fits: (_typeLine, text) => matchesAny(LIFEGAIN, text),
  },
  {
    theme: "spells",
    leads: [
      rule(String.raw`\b(instant (or|and) sorcery|noncreature) spells?\b`),
      rule(String.raw`\b(magecraft|prowess)\b`),
    ],
    fits: (typeLine) => frontFaceHas(typeLine, ["Instant", "Sorcery"]),
  },
  {
    theme: "landfall",
    leads: [
      rule(String.raw`\blandfall\b`),
      rule(String.raw`\bwhenever (a|one or more) lands? [^.]*\benters?\b`),
    ],
    fits: (_typeLine, text) =>
      /\blandfall\b|\bplay (an|two|\w+) additional lands?\b|\blands? cards? [^.]*onto the battlefield\b/i.test(
        text,
      ),
  },
  {
    theme: "equipment",
    leads: [
      rule(String.raw`\b(equipped|enchanted|modified) creatures?\b`),
      rule(String.raw`\b(equipment|auras?)\b`),
    ],
    fits: (typeLine) => frontFaceHas(typeLine, ["Equipment", "Aura"]),
  },
  {
    theme: "politics",
    leads: POLITICS,
    fits: (_typeLine, text) => matchesAny(POLITICS, text),
  },
  {
    theme: "goad",
    leads: GOAD,
    fits: (_typeLine, text) => matchesAny(GOAD, text),
  },
  {
    theme: "voting",
    leads: VOTING,
    fits: (_typeLine, text) => matchesAny(VOTING, text),
  },
  {
    theme: "group-hug",
    leads: GROUP_HUG,
    fits: (_typeLine, text) => matchesAny(GROUP_HUG, text),
  },
  {
    theme: "monarch",
    leads: MONARCH,
    fits: (_typeLine, text) => matchesAny(MONARCH, text),
  },
  {
    theme: "each-opponent",
    leads: EACH_OPPONENT_LEADS,
    fits: (_typeLine, text) => matchesAny(EACH_OPPONENT_FITS, text),
  },
  {
    theme: "blink",
    leads: BLINK_LEADS,
    fits: (_typeLine, text) => matchesAny(BLINK_LEADS, text),
  },
  {
    theme: "wheels",
    leads: WHEELS_LEADS,
    fits: (_typeLine, text) => matchesAny(WHEELS_FITS, text),
  },
  {
    theme: "clones",
    leads: CLONES,
    fits: (_typeLine, text) => matchesAny(CLONES, text),
  },
  {
    theme: "theft",
    leads: THEFT,
    fits: (_typeLine, text) => matchesAny(THEFT, text),
  },
  {
    theme: "planeswalkers",
    leads: PLANESWALKERS_LEADS,
    fits: (typeLine, text) =>
      frontFaceHas(typeLine, ["Planeswalker"]) || matchesAny(PLANESWALKERS_LEADS, text),
  },
  {
    theme: "legends",
    leads: LEGENDS,
    fits: (_typeLine, text) => matchesAny(LEGENDS, text),
  },
  {
    theme: "exile",
    leads: EXILE,
    fits: (typeLine, text) => matchesAny(EXILE, text) || /\bAdventure\b/.test(typeLine),
  },
  {
    theme: "extra-combat",
    leads: EXTRA_COMBAT,
    fits: (_typeLine, text) => matchesAny(EXTRA_COMBAT, text),
  },
  {
    theme: "stax",
    leads: STAX,
    fits: (_typeLine, text) => matchesAny(STAX, text),
  },
  {
    theme: "poison",
    leads: POISON,
    fits: (_typeLine, text) => matchesAny(POISON, text),
  },
  {
    theme: "vehicles",
    leads: VEHICLES,
    fits: (typeLine, text) =>
      matchesAny(VEHICLES, text) ||
      frontFaceHas(typeLine, ["Vehicle", "Mount", "Spacecraft", "Pilot"]),
  },
];

/** The themes some face satisfies, in THEMES order. */
function themesWhere(
  card: CardText,
  matches: (row: ThemeRule, typeLine: string, text: string) => boolean,
) {
  const typeLine = card.faces.map((face) => face.typeLine).join(" // ");
  const texts = card.faces.map((face) => plainText(face.text));
  return THEME_RULES.filter((row) => texts.some((text) => matches(row, typeLine, text))).map(
    (row) => row.theme,
  );
}

/** Haste: a card that gives it (the enablers), or a creature that has it or blitz (the users). */
export const hasHaste = (card: CardText) =>
  grantedKeywords(card).includes("Haste") ||
  card.keywords.some((k) => k === "Haste" || k === "Blitz");

/** The themes a card plays into. */
export const themes: Recognizer<"themes"> = {
  id: "themes",
  field: "themes",
  recognize: (card) => [
    ...themesWhere(card, (row, typeLine, text) => row.fits(typeLine, text)),
    ...(hasHaste(card) ? (["haste"] as const) : []),
  ],
};

/** The themes a commander builds around (read from its text). */
export const leaderThemes: Recognizer<"leaderThemes"> = {
  id: "leader-themes",
  field: "leaderThemes",
  recognize: (card) => [
    ...themesWhere(card, (row, _typeLine, text) => matchesAny(row.leads, text)),
    ...(grantedKeywords(card).includes("Haste") ? (["haste"] as const) : []),
  ],
};
