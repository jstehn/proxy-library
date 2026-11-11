import { BORDERS, FRAME_VERSIONS, IS_VALUES, MAX_PATTERN_LENGTH } from "./parse";
import { TAGS, THEMES } from "./tags";

// Every keyword the card search understands (design docs 14, 15 and 28), modeled on Scryfall's
// syntax guide. The Search help page shows it, and the LLM tools serve it as text
// (`searchHelpText`), so both always describe the same language.

export type SearchHelpRow = Readonly<{ write: string; finds: string; example: string }>;

export const SEARCH_BASICS: readonly SearchHelpRow[] = [
  { write: "words", finds: "names containing all of them", example: "goblin king" },
  { write: '!"name"', finds: "exactly that name", example: '!"Lightning Bolt"' },
  { write: "-term", finds: "everything but that", example: "-t:land" },
  { write: "or", finds: "either side", example: "t:elf or t:goblin" },
  { write: "( )", finds: "groups terms", example: "(c:r or c:g) mv<=2" },
  { write: '"…"', finds: "a phrase with spaces", example: 'o:"draw a card"' },
  {
    write: "/…/",
    finds: `a regular expression (names, o:, t:, a:; up to ${MAX_PATTERN_LENGTH} characters)`,
    example: "o:/draw (a|two) cards?/",
  },
];

export const SEARCH_KEYWORDS: readonly SearchHelpRow[] = [
  { write: "o: oracle:", finds: "rules text", example: 'o:"enters the battlefield"' },
  { write: "t: type:", finds: "type line", example: "t:legendary t:creature" },
  {
    write: "c: color:",
    finds: "colors: at least these (c:), or =, <=, >=, <, >",
    example: "c:rw  c<=bg",
  },
  {
    write: "id: ci:",
    finds: "color identity, including rules text: within these by default",
    example: "id<=esper",
  },
  { write: "mv cmc", finds: "mana value", example: "mv<=2" },
  { write: "m: mana:", finds: "mana cost symbols", example: "m:{G}{G}" },
  {
    write: "pow tou loy def",
    finds: "power, toughness, loyalty, defense",
    example: "pow>=4 loy>=4",
  },
  {
    write: "kw: keyword:",
    finds: "keyword abilities and actions",
    example: 'kw:flying  kw:"first strike"',
  },
  { write: "r: rarity:", finds: "rarity (c, u, r, m)", example: "r>=rare" },
  { write: "s: set:", finds: "set code", example: "s:blb" },
  { write: "cn: number:", finds: "collector number", example: "s:fdn cn<=100" },
  { write: "a: artist:", finds: "artist", example: 'a:"rebecca guay"' },
  { write: "f: format:", finds: "legal in a format", example: "f:pauper" },
  {
    write: "tag: role:",
    finds: `what the card does in a deck: ${TAGS.join(", ")}`,
    example: "tag:ramp mv<=2",
  },
  {
    write: "theme:",
    finds: `what the card plays into: ${THEMES.join(", ")}`,
    example: "theme:tokens t:creature",
  },
  {
    write: "otag: function:",
    finds:
      "Scryfall tagger names that mean one of the tags or themes above (card-draw, board-wipe, sacrifice-outlet, …)",
    example: "otag:card-draw",
  },
  {
    write: "fo: fulloracle:",
    finds: "rules text including reminder text (o: leaves reminder text out)",
    example: 'fo:"can\'t be blocked"',
  },
  {
    write: "~",
    finds:
      'in o: or fo:, the card\'s own name (or its short name, or "this creature" and the like)',
    example: 'o:"when ~ dies"',
  },
  {
    write: "pow>tou",
    finds: "two numbers on the same card compared: pow, tou, loy, def, mv",
    example: "pow>tou  pow>=mv",
  },
  { write: "mv:even mv:odd", finds: "an even or odd mana value", example: "mv:odd" },
  {
    write: "banned: restricted:",
    finds: "banned or restricted in a format",
    example: "banned:commander",
  },
  {
    write: "produces:",
    finds: "mana it can make (W, U, B, R, G, C)",
    example: "produces:g t:artifact",
  },
  { write: "usd", finds: "the cheapest current market price, in dollars", example: "usd<0.50" },
  {
    write: "year date",
    finds: "the set's release year or date",
    example: "year>=2024  date>=2024-08",
  },
  { write: "border:", finds: BORDERS.join(", "), example: "border:borderless" },
  {
    write: "frame:",
    finds: `${FRAME_VERSIONS.join(", ")}, or an effect such as showcase, extendedart, inverted`,
    example: "frame:showcase",
  },
  {
    write: "own owned",
    finds: "how many copies you own (any printing); in a deck using your real cards, real ones too",
    example: "own=0  own>=4",
  },
  {
    write: "free spare",
    finds: "how many copies you own that none of your other decks uses",
    example: "free>0  free>=4",
  },
  {
    write: "real",
    finds: "how many copies you own for real (any printing)",
    example: "real>=1  real=0",
  },
];

export const IS_GROUPS = ["finish", "layout", "treatment", "kind", "land", "bracket"] as const;
export const IS_DESCRIPTIONS: Readonly<Record<(typeof IS_GROUPS)[number], string>> = {
  finish:
    "is:foil means: sold in foil (store), this copy is foil (collection), you own a foil (deck builder)",
  layout: "how the card is laid out (dfc is any double-faced card; mdfc is modal)",
  treatment: "special printings",
  kind: "kinds of card (vanilla: no rules text; frenchvanilla: only keywords; bear: a 2-mana 2/2; modal: choose one —; party: Cleric, Rogue, Warrior or Wizard; outlaw: Assassin, Mercenary, Pirate, Rogue or Warlock; hybrid and phyrexian: mana in the cost)",
  bracket:
    "Commander brackets (gamechanger or gc: on Wizards' Game Changer list; landdenial: mass land denial, including Blood Moon and Back to Basics; extraturn: takes an extra turn). -is:gc leaves Game Changers out",
  land: "land cycles (fetchable: has a basic land type; dual: two types and no rules text; triome: three types; pathway: a land on each face)",
};

/** The whole reference as Markdown, for the LLM tools (design doc 28). */
export function searchHelpText(): string {
  const rows = (list: readonly SearchHelpRow[]) =>
    list.map((row) => `| \`${row.write}\` | ${row.finds} | \`${row.example}\` |`).join("\n");
  const header = "| Write | Finds | Example |\n| --- | --- | --- |\n";
  const isLines = IS_GROUPS.map(
    (group) =>
      `- ${IS_VALUES[group].map((value) => `\`is:${value}\``).join(" ")}: ${IS_DESCRIPTIONS[group]}`,
  ).join("\n");
  return [
    "# Card search",
    "Terms side by side must all match. A part the search can't read is skipped and noted.",
    "## Putting a search together",
    header + rows(SEARCH_BASICS),
    "## Keywords",
    "Numbers and colors take `:` `=` `!=` `<` `<=` `>` `>=`.",
    header + rows(SEARCH_KEYWORDS),
    "## is:",
    isLines,
  ].join("\n\n");
}
