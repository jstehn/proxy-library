// Role tags (design doc 19, section 3): the job a card does in a deck, composed from effect
// primitives (./primitives). Rules as data: one row per tag, matching structured EffectPrimitives
// instead of card-shaped one-off regexes.
import {
  extractEffects,
  isFrontFaceLand,
  withoutReminders,
  type EffectExtractor,
  type EffectPrimitive,
  type TagFacts,
} from "./primitives";

export type { TagFacts } from "./primitives";

export const TAGS = ["ramp", "draw", "removal", "wipe", "counter", "tutor", "protection"] as const;
/** A job a card does in a deck. A card can have several, or none. */
export type Tag = (typeof TAGS)[number];

type TagRule = Readonly<{
  tag: Tag;
  /** The card has the tag if any extracted effect primitive satisfies this predicate. */
  matches: (effects: readonly EffectPrimitive[], card: TagFacts, text: string) => boolean;
  /** Lands never get this tag: a land that taps for mana is a land, not ramp. */
  notOnLands?: boolean;
}>;

const rule = (source: string) => new RegExp(source, "i");

const TAG_RULES: readonly TagRule[] = [
  {
    tag: "ramp",
    notOnLands: true,
    matches: (effects) =>
      effects.some(
        (e) =>
          e.kind === "mana_production" ||
          (e.kind === "search_library" && e.subject === "land" && e.toZone === "battlefield") ||
          e.kind === "extra_land_play" ||
          e.kind === "put_land_from_hand" ||
          (e.kind === "create_token" && e.tokenKind === "treasure"),
      ),
  },
  {
    tag: "draw",
    matches: (effects) => effects.some((e) => e.kind === "draw_cards" && !e.conditional),
  },
  {
    tag: "removal",
    matches: (effects) =>
      effects.some(
        (e) =>
          (e.kind === "destroy_or_exile" &&
            e.scope === "target" &&
            e.excludesYouControl &&
            !e.fromGraveyard &&
            e.subject !== "land") ||
          (e.kind === "damage" &&
            e.scope === "target" &&
            (e.subject === "any_target" ||
              e.subject === "creature" ||
              e.subject === "planeswalker" ||
              e.subject === "battle")) ||
          (e.kind === "fight" && e.scope === "target") ||
          (e.kind === "modify_pt" && e.scope === "target" && e.negative) ||
          e.kind === "prevent_combat" ||
          (e.kind === "bounce" && e.scope === "target" && e.excludesYouControl),
      ),
  },
  {
    tag: "wipe",
    matches: (effects) =>
      effects.some(
        (e) =>
          (e.kind === "destroy_or_exile" &&
            e.scope === "all" &&
            e.excludesYouControl &&
            e.subject !== "land") ||
          (e.kind === "damage" && e.scope === "all" && e.excludesYouControl) ||
          (e.kind === "modify_pt" &&
            (e.scope === "all" || e.scope === "opponents") &&
            e.negative) ||
          (e.kind === "bounce" && e.scope === "all" && e.excludesYouControl) ||
          (e.kind === "fight" && e.scope === "token_per_opponent_creature") ||
          e.kind === "sacrifice_all",
      ),
  },
  {
    tag: "counter",
    matches: (effects) => effects.some((e) => e.kind === "counter_stack"),
  },
  {
    tag: "tutor",
    matches: (effects) =>
      effects.some((e) => e.kind === "search_library" && e.subject === "card" && !e.namedOnly),
  },
  {
    tag: "protection",
    matches: (effects) =>
      effects.some((e) => e.kind === "grant_protection" || e.kind === "phase_out"),
  },
];

/** The roles a card plays, in TAGS order. */
export function cardTags(card: TagFacts, extractors?: readonly EffectExtractor[]): Tag[] {
  const text = withoutReminders(card.text);
  const land = isFrontFaceLand(card.typeLine);
  const effects = extractEffects(card, extractors);
  return TAG_RULES.filter(
    (row) => !(row.notOnLands && land) && row.matches(effects, card, text),
  ).map((row) => row.tag);
}

// Themes (design docs 20 and 38): what a deck builds around. A theme has two sides: what a
// commander says when it leads one ("sacrifice another creature"), and what a card says when it
// plays into one ("when this dies"). Umbrella themes (tokens, artifact-tokens, politics) overlap
// with their sub-themes so specific matches score higher while broad searches still find all of them.

export const THEMES = [
  "counters",
  "tokens",
  "creature-tokens",
  "artifact-tokens",
  "treasures",
  "food",
  "clues",
  "sacrifice",
  "graveyard",
  "artifacts",
  "enchantments",
  "lifegain",
  "spells",
  "landfall",
  "equipment",
  "politics",
  "goad",
  "voting",
  "group-hug",
  "monarch",
  "each-opponent",
  "blink",
  "wheels",
  "clones",
  "theft",
  "planeswalkers",
  "legends",
  "exile",
  "extra-combat",
  "stax",
  "poison",
  "vehicles",
] as const;
/** Something a deck builds around. */
export type Theme = (typeof THEMES)[number];

type ThemeRule = Readonly<{
  theme: Theme;
  /** How the builder names it: "+1/+1 counters". */
  label: string;
  /** A commander leads this theme if its text matches one of these. */
  leads: readonly RegExp[];
  /** A card plays into this theme. */
  fits: (card: TagFacts, text: string) => boolean;
}>;

const matchesAny = (patterns: readonly RegExp[], text: string) =>
  patterns.some((pattern) => pattern.test(text));
const firstFace = (card: TagFacts) => card.typeLine.split(" // ")[0];

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
    label: "+1/+1 counters",
    leads: COUNTERS,
    fits: (_card, text) => matchesAny(COUNTERS, text),
  },
  {
    theme: "tokens",
    label: "Tokens",
    leads: [...TOKENS, rule(String.raw`\bwhenever [^.]*\btokens? [^.]*\benters?\b`)],
    fits: (_card, text) => matchesAny(TOKENS, text),
  },
  {
    theme: "creature-tokens",
    label: "Creature tokens",
    leads: CREATURE_TOKENS,
    fits: (_card, text) => matchesAny(CREATURE_TOKENS, text),
  },
  {
    theme: "artifact-tokens",
    label: "Artifact tokens",
    leads: ARTIFACT_TOKENS,
    fits: (card, text) =>
      matchesAny(ARTIFACT_TOKENS, text) || /\b(Treasure|Food|Clue)\b/.test(firstFace(card)),
  },
  {
    theme: "treasures",
    label: "Treasures",
    leads: TREASURES,
    fits: (card, text) => matchesAny(TREASURES, text) || /\bTreasure\b/.test(firstFace(card)),
  },
  {
    theme: "food",
    label: "Food",
    leads: FOOD,
    fits: (card, text) => matchesAny(FOOD, text) || /\bFood\b/.test(firstFace(card)),
  },
  {
    theme: "clues",
    label: "Clues",
    leads: CLUES,
    fits: (card, text) => matchesAny(CLUES, text) || /\bClue\b/.test(firstFace(card)),
  },
  {
    theme: "sacrifice",
    label: "Sacrifice",
    leads: [
      rule(
        String.raw`\bsacrifices? (a|an|another|one or more|x|\w+) (other )?(creatures?|artifacts?|permanents?)\b`,
      ),
      rule(String.raw`\bwhenever (a|another|one or more) [^.]*creatures? [^.]*\bdies?\b`),
    ],
    fits: (_card, text) => /\bsacrifice\b|\bdies\b/i.test(text),
  },
  {
    theme: "graveyard",
    label: "Graveyard",
    leads: [rule(String.raw`\b(from|in) your graveyard\b`), rule(String.raw`\bmills?\b`)],
    fits: (_card, text) =>
      /\bgraveyard\b|\bmills?\b|\bsurveil\b|\b(flashback|unearth|escape|embalm|eternalize|encore|dredge)\b/i.test(
        text,
      ),
  },
  {
    theme: "artifacts",
    label: "Artifacts",
    leads: [rule(String.raw`\b(whenever|for each|number of) [^.]*\bartifacts?\b`)],
    fits: (card) => /\bArtifact\b/.test(firstFace(card)),
  },
  {
    theme: "enchantments",
    label: "Enchantments",
    leads: [rule(String.raw`\b(whenever|for each|number of) [^.]*\benchantments?\b`)],
    fits: (card) => /\bEnchantment\b/.test(firstFace(card)),
  },
  {
    theme: "lifegain",
    label: "Lifegain",
    leads: [rule(String.raw`\bwhenever you gain life\b`), rule(String.raw`\bgained life\b`)],
    fits: (_card, text) => matchesAny(LIFEGAIN, text),
  },
  {
    theme: "spells",
    label: "Instants and sorceries",
    leads: [
      rule(String.raw`\b(instant (or|and) sorcery|noncreature) spells?\b`),
      rule(String.raw`\b(magecraft|prowess)\b`),
    ],
    fits: (card) => /\b(Instant|Sorcery)\b/.test(firstFace(card)),
  },
  {
    theme: "landfall",
    label: "Landfall",
    leads: [
      rule(String.raw`\blandfall\b`),
      rule(String.raw`\bwhenever (a|one or more) lands? [^.]*\benters?\b`),
    ],
    fits: (_card, text) =>
      /\blandfall\b|\bplay (an|two|\w+) additional lands?\b|\blands? cards? [^.]*onto the battlefield\b/i.test(
        text,
      ),
  },
  {
    theme: "equipment",
    label: "Equipment and Auras",
    leads: [
      rule(String.raw`\b(equipped|enchanted|modified) creatures?\b`),
      rule(String.raw`\b(equipment|auras?)\b`),
    ],
    fits: (card) => /\b(Equipment|Aura)\b/.test(firstFace(card)),
  },
  {
    theme: "politics",
    label: "Politics",
    leads: POLITICS,
    fits: (_card, text) => matchesAny(POLITICS, text),
  },
  {
    theme: "goad",
    label: "Goad",
    leads: GOAD,
    fits: (_card, text) => matchesAny(GOAD, text),
  },
  {
    theme: "voting",
    label: "Voting",
    leads: VOTING,
    fits: (_card, text) => matchesAny(VOTING, text),
  },
  {
    theme: "group-hug",
    label: "Group hug",
    leads: GROUP_HUG,
    fits: (_card, text) => matchesAny(GROUP_HUG, text),
  },
  {
    theme: "monarch",
    label: "Monarch and initiative",
    leads: MONARCH,
    fits: (_card, text) => matchesAny(MONARCH, text),
  },
  {
    theme: "each-opponent",
    label: "Each opponent",
    leads: EACH_OPPONENT_LEADS,
    fits: (_card, text) => matchesAny(EACH_OPPONENT_FITS, text),
  },
  {
    theme: "blink",
    label: "Blink and flicker",
    leads: BLINK_LEADS,
    fits: (_card, text) => matchesAny(BLINK_LEADS, text),
  },
  {
    theme: "wheels",
    label: "Discard and wheels",
    leads: WHEELS_LEADS,
    fits: (_card, text) => matchesAny(WHEELS_FITS, text),
  },
  {
    theme: "clones",
    label: "Copy and clones",
    leads: CLONES,
    fits: (_card, text) => matchesAny(CLONES, text),
  },
  {
    theme: "theft",
    label: "Theft",
    leads: THEFT,
    fits: (_card, text) => matchesAny(THEFT, text),
  },
  {
    theme: "planeswalkers",
    label: "Planeswalkers",
    leads: PLANESWALKERS_LEADS,
    fits: (card, text) =>
      /\bPlaneswalker\b/.test(firstFace(card)) || matchesAny(PLANESWALKERS_LEADS, text),
  },
  {
    theme: "legends",
    label: "Legends and historic",
    leads: LEGENDS,
    fits: (_card, text) => matchesAny(LEGENDS, text),
  },
  {
    theme: "exile",
    label: "Cast from exile",
    leads: EXILE,
    fits: (card, text) => matchesAny(EXILE, text) || /\bAdventure\b/.test(card.typeLine),
  },
  {
    theme: "extra-combat",
    label: "Extra combat",
    leads: EXTRA_COMBAT,
    fits: (_card, text) => matchesAny(EXTRA_COMBAT, text),
  },
  {
    theme: "stax",
    label: "Taxes and stax",
    leads: STAX,
    fits: (_card, text) => matchesAny(STAX, text),
  },
  {
    theme: "poison",
    label: "Poison and infect",
    leads: POISON,
    fits: (_card, text) => matchesAny(POISON, text),
  },
  {
    theme: "vehicles",
    label: "Vehicles and mounts",
    leads: VEHICLES,
    fits: (card, text) =>
      matchesAny(VEHICLES, text) || /\b(Vehicle|Mount|Spacecraft|Pilot)\b/.test(firstFace(card)),
  },
];

/** The themes a card plays into. */
export function cardThemes(card: TagFacts): Theme[] {
  const text = withoutReminders(card.text);
  return THEME_RULES.filter((row) => row.fits(card, text)).map((row) => row.theme);
}

/** The themes a commander builds around (read from its text). */
export function leaderThemes(card: TagFacts): Theme[] {
  const text = withoutReminders(card.text);
  return THEME_RULES.filter((row) => matchesAny(row.leads, text)).map((row) => row.theme);
}

/** How the builder names each theme. */
export const THEME_LABELS: Readonly<Record<Theme, string>> = Object.fromEntries(
  THEME_RULES.map((row) => [row.theme, row.label]),
) as Record<Theme, string>;

/**
 * Bumped whenever TAG_RULES, THEME_RULES or BRACKET_TEXT_RULES (./brackets.ts) change: the
 * catalog sync then works out every printing's stored features again (design doc 20,
 * invariant 1). Version 2: bracket flags (design doc 31). Version 3: expanded themes (design
 * doc 38). Version 4: one-sided -X/-X wipes like Massacre Wurm (design doc 61).
 */
export const CARD_FEATURES_VERSION = 4;
