import type { Color } from "@/modules/catalog";
import { COLOR_COMBINATIONS } from "@/shared/kernel";

// The deck builder's search language (design doc 14, section 2.3), modeled on Scryfall's. Pure:
// text in, a tree of conditions out, plus notes about anything it couldn't read. The SQL lives in
// decks/queries/search-sql.ts.
//
//   bolt                   name contains "bolt"
//   o:"draw a card"        rules text contains the phrase
//   t:legendary t:creature type line contains both
//   c:rw  c<=bg  c:m       colors (at least red and white; within black-green; multicolored)
//   id<=esper              color identity within white-blue-black
//   mv<=2  pow>=4          mana value, power, toughness
//   -t:land  (a or b)      not, or, parentheses

/** The fields a search term can be about. */
export type SearchField =
  | "name"
  | "oracle"
  | "type"
  | "color"
  | "identity"
  | "manaValue"
  | "mana"
  | "power"
  | "toughness"
  | "rarity"
  | "set"
  | "format"
  | "is";

export type Comparison = "=" | "!=" | "<" | "<=" | ">" | ">=" | ":";

/** One condition, e.g. `mv<=2` is { field: "manaValue", comparison: "<=", value: "2" }. */
export type SearchTerm = Readonly<{ field: SearchField; comparison: Comparison; value: string }>;

export type SearchNode =
  | Readonly<{ kind: "all" }> // an empty search matches everything
  | Readonly<{ kind: "term"; term: SearchTerm }>
  | Readonly<{ kind: "not"; child: SearchNode }>
  | Readonly<{ kind: "and"; children: readonly SearchNode[] }>
  | Readonly<{ kind: "or"; children: readonly SearchNode[] }>;

export type ParsedSearch = Readonly<{
  node: SearchNode;
  /** Parts that were ignored, in words, e.g. `Unknown keyword "foo:" (ignored)`. */
  notes: readonly string[];
}>;

/** Keywords and their aliases, as Scryfall spells them. */
const KEYWORDS: Readonly<Record<string, SearchField>> = {
  o: "oracle",
  oracle: "oracle",
  t: "type",
  type: "type",
  c: "color",
  color: "color",
  colors: "color",
  id: "identity",
  ci: "identity",
  identity: "identity",
  mv: "manaValue",
  cmc: "manaValue",
  manavalue: "manaValue",
  m: "mana",
  mana: "mana",
  pow: "power",
  power: "power",
  tou: "toughness",
  toughness: "toughness",
  r: "rarity",
  rarity: "rarity",
  s: "set",
  set: "set",
  e: "set",
  f: "format",
  format: "format",
  legal: "format",
  is: "is",
  name: "name",
};

const NUMERIC_FIELDS = new Set<SearchField>(["manaValue", "power", "toughness"]);
const IS_VALUES = new Set(["foil", "commander"]);
const RARITIES = new Set(["common", "uncommon", "rare", "mythic", "special", "bonus"]);
const RARITY_SHORT: Readonly<Record<string, string>> = {
  c: "common",
  u: "uncommon",
  r: "rare",
  m: "mythic",
};

// --- Words -------------------------------------------------------------------------------

type Token =
  | Readonly<{ kind: "open" }>
  | Readonly<{ kind: "close" }>
  | Readonly<{ kind: "or" }>
  | Readonly<{ kind: "word"; text: string; negated: boolean }>;

/**
 * Splits the search into words, keeping quoted phrases together (`o:"draw a card"` is one word)
 * and noting a leading `-` (not). Parentheses are their own tokens.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index++;
    } else if (character === "(") {
      tokens.push({ kind: "open" });
      index++;
    } else if (character === ")") {
      tokens.push({ kind: "close" });
      index++;
    } else {
      let negated = false;
      if (character === "-" && index + 1 < text.length && !/\s/.test(text[index + 1])) {
        negated = true;
        index++;
      }
      let word = "";
      let inQuotes = false;
      while (index < text.length) {
        const next = text[index];
        if (next === '"') inQuotes = !inQuotes;
        else if (!inQuotes && (/\s/.test(next) || next === "(" || next === ")")) break;
        else word += next;
        index++;
      }
      if (!negated && word.toLowerCase() === "or") tokens.push({ kind: "or" });
      else if (word !== "") tokens.push({ kind: "word", text: word, negated });
    }
  }
  return tokens;
}

/** `mv<=2` → { keyword: "mv", comparison: "<=", value: "2" }; a bare word has no keyword. */
function splitWord(word: string): {
  keyword: string | null;
  comparison: Comparison;
  value: string;
} {
  const match = /^([a-z]+)(<=|>=|!=|=|<|>|:)(.*)$/i.exec(word);
  if (match === null) return { keyword: null, comparison: ":", value: word };
  return { keyword: match[1].toLowerCase(), comparison: match[2] as Comparison, value: match[3] };
}

// --- Parsing -----------------------------------------------------------------------------

/**
 * Parses a search. Words next to each other must all match (and); `or` between them means
 * either; parentheses group. Unknown keywords and unreadable values are left out and noted,
 * like Scryfall, so a typo never empties the results.
 */
export function parseSearch(text: string): ParsedSearch {
  const tokens = tokenize(text);
  const notes: string[] = [];
  let position = 0;

  function parseOr(): SearchNode {
    const options: SearchNode[] = [parseAnd()];
    while (tokens[position]?.kind === "or") {
      position++;
      options.push(parseAnd());
    }
    return simplify({ kind: "or", children: options });
  }

  function parseAnd(): SearchNode {
    const parts: SearchNode[] = [];
    while (position < tokens.length) {
      const token = tokens[position];
      if (token.kind === "or" || token.kind === "close") break;
      position++;
      if (token.kind === "open") {
        const inner = parseOr();
        if (tokens[position]?.kind === "close") position++;
        else notes.push("A parenthesis isn't closed (treated as closed at the end)");
        parts.push(inner);
      } else if (token.kind === "word") {
        const node = wordNode(token.text, notes);
        if (node !== null) parts.push(token.negated ? { kind: "not", child: node } : node);
      }
    }
    return simplify({ kind: "and", children: parts });
  }

  const node = parseOr();
  while (position < tokens.length) {
    // A stray ")" with nothing open: skip it and read on.
    if (tokens[position].kind === "close") notes.push('An extra ")" was ignored');
    position++;
  }
  return { node, notes };
}

/** One word as a condition, or null (with a note) when it can't be read. */
function wordNode(word: string, notes: string[]): SearchNode | null {
  const { keyword, comparison, value } = splitWord(word);
  if (keyword === null) return { kind: "term", term: { field: "name", comparison: ":", value } };

  const field = KEYWORDS[keyword];
  if (field === undefined) {
    notes.push(`Unknown keyword "${keyword}${comparison}" (ignored)`);
    return null;
  }
  if (value === "") {
    notes.push(`"${word}" has no value (ignored)`);
    return null;
  }
  const problem = valueProblem(field, comparison, value);
  if (problem !== null) {
    notes.push(`${problem} (ignored)`);
    return null;
  }
  return { kind: "term", term: { field, comparison, value } };
}

function valueProblem(field: SearchField, comparison: Comparison, value: string): string | null {
  if (NUMERIC_FIELDS.has(field) && !/^-?\d+(\.\d+)?$/.test(value)) {
    return `"${value}" isn't a number`;
  }
  if ((field === "color" || field === "identity") && parseColors(value) === null) {
    return `"${value}" isn't a color`;
  }
  if (field === "rarity" && rarityName(value) === null) return `"${value}" isn't a rarity`;
  if (field === "is" && !IS_VALUES.has(value.toLowerCase())) {
    return `"is:${value}" isn't supported (try is:foil or is:commander)`;
  }
  const textField = ["name", "oracle", "type", "set", "format", "mana", "is"].includes(field);
  if (textField && comparison !== ":" && comparison !== "=" && comparison !== "!=") {
    return `"${comparison}" doesn't apply to text`;
  }
  return null;
}

/** Removes needless nesting: an "and" of one thing is that thing. */
function simplify(node: SearchNode): SearchNode {
  if (node.kind !== "and" && node.kind !== "or") return node;
  if (node.children.length === 0) return { kind: "all" };
  if (node.children.length === 1) return node.children[0];
  return node;
}

// --- Values ------------------------------------------------------------------------------

const COLOR_NAMES: Readonly<Record<string, readonly Color[]>> = {
  white: ["W"],
  blue: ["U"],
  black: ["B"],
  red: ["R"],
  green: ["G"],
  ...Object.fromEntries(
    COLOR_COMBINATIONS.map((combination) => {
      const name = /\(([^)]+)\)/.exec(combination.label)?.[1] ?? combination.code;
      return [name.toLowerCase().replace(/[^a-z]/g, ""), combination.colors as readonly Color[]];
    }),
  ),
};

/** A color value: "multicolored", "colorless", or a set of colors. */
export type ColorValue =
  | Readonly<{ kind: "multicolored" }>
  | Readonly<{ kind: "colorless" }>
  | Readonly<{ kind: "colors"; colors: readonly Color[] }>;

/**
 * Reads a color value: letters (`rw`, `wubrg`), color names (`red`), guild, shard and wedge
 * names (`simic`, `esper`, `abzan`), `m` / `multicolor` and `c` / `colorless`. Null if it isn't
 * a color.
 */
export function parseColors(value: string): ColorValue | null {
  const text = value.toLowerCase();
  if (text === "m" || text === "multi" || text === "multicolor" || text === "multicolored") {
    return { kind: "multicolored" };
  }
  if (text === "c" || text === "colorless") return { kind: "colorless" };
  const named = COLOR_NAMES[text.replace(/[^a-z]/g, "")];
  if (named !== undefined) return { kind: "colors", colors: named };
  if (/^[wubrg]+$/.test(text)) {
    const colors = [...new Set(text.toUpperCase())] as Color[];
    return { kind: "colors", colors };
  }
  return null;
}

/** "m" or "mythic" → "mythic"; null if it isn't a rarity. */
export function rarityName(value: string): string | null {
  const text = value.toLowerCase();
  if (RARITIES.has(text)) return text;
  return RARITY_SHORT[text] ?? null;
}

/** The mana symbols in a cost search (`{G}{G}`, `gg` or `2g`), each with how many are needed. */
export function manaSymbols(value: string): Map<string, number> {
  const symbols = new Map<string, number>();
  const add = (symbol: string) => symbols.set(symbol, (symbols.get(symbol) ?? 0) + 1);
  const braced = value.match(/\{[^}]+\}/g);
  if (braced) {
    for (const symbol of braced) add(symbol.toUpperCase());
  } else {
    for (const character of value.toUpperCase()) {
      if (/[WUBRGCXS]/.test(character)) add(`{${character}}`);
      else if (/\d/.test(character)) add(`{${character}}`);
    }
  }
  return symbols;
}

/**
 * The search with one term added, or removed if it's already there: what a quick-filter button
 * does, so the box always shows the whole search. Terms in the same `family` replace each other
 * (one mana value at a time): `family` matches the start of a term, like "mv".
 */
export function toggleTerm(search: string, term: string, family?: RegExp): string {
  const words = search
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const lower = term.toLowerCase();
  if (words.some((word) => word.toLowerCase() === lower)) {
    return words.filter((word) => word.toLowerCase() !== lower).join(" ");
  }
  const kept = family === undefined ? words : words.filter((word) => !family.test(word));
  return [...kept, term].join(" ");
}

/** Whether the search contains this exact term (a quick-filter button shows it as pressed). */
export function hasTerm(search: string, term: string): boolean {
  const lower = term.toLowerCase();
  return search.split(/\s+/).some((word) => word.toLowerCase() === lower);
}
