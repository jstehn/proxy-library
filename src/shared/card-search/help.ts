import { BORDERS, FRAME_VERSIONS, IS_VALUES, MAX_PATTERN_LENGTH, SECURITY_STAMPS } from "./parse";
import { TAGS, THEMES } from "@/shared/mtg";

// Every keyword the card search understands (design docs 14, 15 and 28), modeled on Scryfall's
// syntax guide. The Search help page shows it, and the LLM tools serve it as text
// (`searchHelpText`), so both always describe the same language.

export type SearchHelpRow = Readonly<{ write: string; finds: string; example: string }>;

export const SEARCH_BASICS: readonly SearchHelpRow[] = [
  { write: "words", finds: "names containing all of them", example: "goblin king" },
  { write: '!"name"', finds: "exactly that name", example: '!"Lightning Bolt"' },
  {
    write: "-term",
    finds: "everything but that (also -(a or b))",
    example: "-(t:land or t:artifact)",
  },
  { write: "or", finds: "either side", example: "t:elf or t:goblin" },
  { write: "( )", finds: "groups terms", example: "(c:r or c:g) mv<=2" },
  { write: "\"…\" '…'", finds: "a phrase with spaces", example: 'o:"draw a card"' },
  {
    write: "/…/",
    finds: `a regular expression (names, o:, fo:, t:, a:, ft:; up to ${MAX_PATTERN_LENGTH} characters)`,
    example: "o:/draw (a|two) cards?/",
  },
];

export const SEARCH_KEYWORDS: readonly SearchHelpRow[] = [
  { write: "o: oracle:", finds: "rules text", example: 'o:"enters the battlefield"' },
  { write: "t: type:", finds: "type line", example: "t:legendary t:creature" },
  {
    write: "c: color:",
    finds: "colors: at least these (c:), counts (c=2, c:mono), or =, <=, >=, <, >",
    example: "c:rw  c<=bg  c=2",
  },
  {
    write: "id: ci: commander:",
    finds: "color identity, including rules text: within these by default, or counts (id<=2)",
    example: "id<=esper  id=2",
  },
  { write: "mv cmc", finds: "mana value", example: "mv<=2" },
  {
    write: "m: mana:",
    finds: "mana cost symbols (m: or m>= at least, m= exact, m<= subset)",
    example: "m:{G}{G}  m=2g",
  },
  {
    write: "dev: devotion:",
    finds: "devotion to colors or total pip count in mana cost",
    example: "dev:ggg  dev>=3",
  },
  {
    write: "pow tou pt loy def",
    finds: "power, toughness, power+toughness, loyalty, defense (also pow:*)",
    example: "pow>=4  pt>=8  loy>=4",
  },
  {
    write: "kw: keyword:",
    finds: "keyword abilities and actions",
    example: 'kw:flying  kw:"first strike"',
  },
  { write: "r: rarity:", finds: "rarity (c, u, r, m)", example: "r>=rare" },
  { write: "s: set: e: edition:", finds: "set code", example: "s:blb" },
  {
    write: "st: set_type:",
    finds: "set type (expansion, commander, core, masters, …)",
    example: "st:commander",
  },
  { write: "cn: number:", finds: "collector number", example: "s:fdn cn<=100" },
  { write: "a: artist:", finds: "artist", example: 'a:"rebecca guay"' },
  { write: "ft: flavor:", finds: "flavor text (supports /pattern/)", example: 'ft:"urza"' },
  { write: "wm: watermark:", finds: "printed watermark", example: "wm:izzet" },
  { write: "f: format:", finds: "legal in a format", example: "f:pauper" },
  { write: "not:", finds: "shorthand for -is: (any is: value)", example: "not:reprint  not:foil" },
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
    finds: "mana it can make (W, U, B, R, G, C), comparisons (=, <=, >=), or count",
    example: "produces:g  produces>=2",
  },
  { write: "usd", finds: "the cheapest current market price, in dollars", example: "usd<0.50" },
  { write: "edhrec", finds: "EDHREC popularity rank (1 is most popular)", example: "edhrec<=500" },
  {
    write: "prints sets illustrations",
    finds: "how many printings, sets, or distinct artworks this card has",
    example: "prints=1  sets>=5",
  },
  {
    write: "in:",
    finds: "printed in a finish (foil, nonfoil, etched) or set code",
    example: "in:foil  in:blb",
  },
  {
    write: "year date",
    finds: "the set's release year, date, or another set's code",
    example: "year>=2024  date>=blb",
  },
  {
    write: "layout:",
    finds: "card layout (normal, transform, modal_dfc, split, …)",
    example: "layout:modal_dfc",
  },
  { write: "border:", finds: BORDERS.join(", "), example: "border:borderless" },
  {
    write: "frame:",
    finds: `${FRAME_VERSIONS.join(", ")}, or an effect such as showcase, extendedart, inverted`,
    example: "frame:showcase",
  },
  {
    write: "stamp:",
    finds: `security stamp (${SECURITY_STAMPS.join(", ")})`,
    example: "stamp:triangle",
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

export const IS_GROUPS = [
  "finish",
  "layout",
  "treatment",
  "frame",
  "kind",
  "land",
  "bracket",
] as const;
export const IS_DESCRIPTIONS: Readonly<Record<(typeof IS_GROUPS)[number], string>> = {
  finish:
    "is:foil means: sold in foil (store), this copy is foil (collection), you own a foil (deck builder); is:nonfoil and is:etched check available finishes",
  layout:
    "how the card is laid out (dfc/doublefaced/doublesided is any double-faced card; mdfc is modal)",
  treatment: "special printings (ub/universesbeyond, boosterfun, spotlight, textless, booster)",
  frame:
    "frame era (old, new, modern, future) and frame effects (inverted, nyxtouched, tombstone, colorshifted)",
  kind: "kinds of card (brawler, companion, partner, vanilla, frenchvanilla, bear, modal, party, outlaw, hybrid, phyrexian, etb, reprint, firstprint, reserved, funny, acorn)",
  bracket:
    "Commander brackets (gamechanger or gc: on Wizards' Game Changer list; landdenial: mass land denial, including Blood Moon and Back to Basics; extraturn: takes an extra turn). -is:gc leaves Game Changers out",
  land: "land cycles (fetchable, dual, shockland, fetchland, checkland, fastland, slowland, bondland, painland, filterland, horizonland, tangoland, shadowland, bounceland, scryland, surveilland, gainland, verge, triome, triland, cycleland, storageland, manland, pathway, tapland)",
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
