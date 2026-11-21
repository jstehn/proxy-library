// The words that name what a card does (design doc 66): role tags here, themes and bracket flags
// as their recognizers arrive. The search parser checks `tag:` against them, and `shared/` may not
// import a module (ADR 0009), so like `COLORS` they are words every module shares.

export const TAGS = ["ramp", "draw", "removal", "wipe", "counter", "tutor", "protection"] as const;
/** A job a card does in a deck. A card can have several, or none. */
export type Tag = (typeof TAGS)[number];

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
  "haste",
] as const;
/** Something a deck builds around. */
export type Theme = (typeof THEMES)[number];

/** How the builder names each theme. */
export const THEME_LABELS: Readonly<Record<Theme, string>> = {
  haste: "Haste",
  counters: "+1/+1 counters",
  tokens: "Tokens",
  "creature-tokens": "Creature tokens",
  "artifact-tokens": "Artifact tokens",
  treasures: "Treasures",
  food: "Food",
  clues: "Clues",
  sacrifice: "Sacrifice",
  graveyard: "Graveyard",
  artifacts: "Artifacts",
  enchantments: "Enchantments",
  lifegain: "Lifegain",
  spells: "Instants and sorceries",
  landfall: "Landfall",
  equipment: "Equipment and Auras",
  politics: "Politics",
  goad: "Goad",
  voting: "Voting",
  "group-hug": "Group hug",
  monarch: "Monarch and initiative",
  "each-opponent": "Each opponent",
  blink: "Blink and flicker",
  wheels: "Discard and wheels",
  clones: "Copy and clones",
  theft: "Theft",
  planeswalkers: "Planeswalkers",
  legends: "Legends and historic",
  exile: "Cast from exile",
  "extra-combat": "Extra combat",
  stax: "Taxes and stax",
  poison: "Poison and infect",
  vehicles: "Vehicles and mounts",
};

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
/** What kind of thing a deck keeps doing (design doc 28, section 3.7). */
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** The themes a card makes and the themes it uses, for matching a card to the deck it plays in. */
export type SignalIO = Readonly<{ makes: readonly Theme[]; uses: readonly Theme[] }>;

export const BRACKET_FLAGS = ["gameChanger", "landDenial", "extraTurn"] as const;
/** A reason a card counts against a bracket. A card can have several, or none. */
export type BracketFlag = (typeof BRACKET_FLAGS)[number];
