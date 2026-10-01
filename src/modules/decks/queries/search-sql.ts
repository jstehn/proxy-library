import { sql, type SQL } from "drizzle-orm";
import type { UserId } from "@/shared/kernel";
import {
  manaSymbols,
  parseColors,
  rarityName,
  type Comparison,
  type SearchNode,
  type SearchTerm,
} from "../domain/search";

// Turns a parsed search (domain/search.ts) into SQL conditions on printings aliased "p"
// (design doc 14, section 6). Every value is a parameter: nothing typed is pasted into SQL.

export type SearchContext = Readonly<{ userId: UserId }>;

/** The search as one SQL condition. */
export function searchCondition(node: SearchNode, context: SearchContext): SQL {
  switch (node.kind) {
    case "all":
      return sql`true`;
    case "not":
      return sql`not (${searchCondition(node.child, context)})`;
    case "and":
      return sql`(${sql.join(
        node.children.map((child) => searchCondition(child, context)),
        sql` and `,
      )})`;
    case "or":
      return sql`(${sql.join(
        node.children.map((child) => searchCondition(child, context)),
        sql` or `,
      )})`;
    case "term":
      return termCondition(node.term, context);
  }
}

/** `%text%` for ILIKE, with the text's own % and _ escaped so they match literally. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** A text condition, negated for `!=`. */
function textTerm(condition: SQL, comparison: Comparison): SQL {
  return comparison === "!=" ? sql`not (${condition})` : condition;
}

const NUMERIC_OPERATORS: Readonly<Record<Comparison, string>> = {
  ":": "=",
  "=": "=",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

function termCondition(term: SearchTerm, context: SearchContext): SQL {
  const { comparison, value } = term;
  switch (term.field) {
    case "name":
      return textTerm(
        comparison === "="
          ? sql`lower(p.name) = lower(${value})`
          : sql`p.name ilike ${containing(value)}`,
        comparison,
      );
    case "oracle":
      return textTerm(
        sql`exists (select 1 from jsonb_array_elements(p.faces) face
                     where face->>'text' ilike ${containing(value)})`,
        comparison,
      );
    case "type":
      return textTerm(sql`p.type_line ilike ${containing(value)}`, comparison);
    case "color":
      // Scryfall's default for colors is "at least these" (c:rw finds Boros and Mardu cards).
      return colorCondition(sql`p.colors`, comparison === ":" ? ">=" : comparison, value);
    case "identity":
      // …and for identity, "within these" (id:rw finds what a Boros commander can play).
      return colorCondition(sql`p.color_identity`, comparison === ":" ? "<=" : comparison, value);
    case "manaValue":
      return sql`p.mana_value ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    case "power":
    case "toughness": {
      const key = term.field;
      return sql`exists (select 1 from jsonb_array_elements(p.faces) face
                          where face->>${key} ~ '^-?[0-9]+$'
                            and (face->>${key})::int ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)})`;
    }
    case "mana":
      return textTerm(manaCondition(value), comparison);
    case "rarity":
      return rarityCondition(comparison, rarityName(value) ?? value);
    case "set":
      return textTerm(sql`p.set_code = ${value.toUpperCase()}`, comparison);
    case "format":
      return textTerm(
        sql`p.legalities->>${value.toLowerCase()} in ('legal', 'restricted')`,
        comparison,
      );
    case "is":
      return textTerm(isCondition(value.toLowerCase(), context), comparison);
  }
}

/** Colors (or identity) compared with a set of colors, as Scryfall does. */
function colorCondition(column: SQL, comparison: Comparison, value: string): SQL {
  const parsed = parseColors(value);
  if (parsed === null) return sql`false`; // the parser already refuses these
  if (parsed.kind === "multicolored") {
    return comparison === "!=" ? sql`cardinality(${column}) <= 1` : sql`cardinality(${column}) > 1`;
  }
  if (parsed.kind === "colorless") {
    return comparison === "!=" ? sql`cardinality(${column}) > 0` : sql`cardinality(${column}) = 0`;
  }
  const colors = sql`array[${sql.join(
    parsed.colors.map((color) => sql`${color}`),
    sql`, `,
  )}]::text[]`;
  const atLeast = sql`${column} @> ${colors}`;
  const within = sql`${column} <@ ${colors}`;
  switch (comparison) {
    case ":":
    case ">=":
      return atLeast;
    case "<=":
      return within;
    case "=":
      return sql`(${atLeast} and ${within})`;
    case "!=":
      return sql`not (${atLeast} and ${within})`;
    case "<":
      return sql`(${within} and not ${atLeast})`;
    case ">":
      return sql`(${atLeast} and not ${within})`;
  }
}

/** Each mana symbol at least as many times as asked (`m:{G}{G}` needs two {G}). */
function manaCondition(value: string): SQL {
  const parts = [...manaSymbols(value)].map(
    ([symbol, count]) =>
      sql`(char_length(coalesce(p.mana_cost, '')) - char_length(replace(coalesce(p.mana_cost, ''), ${symbol}, ''))) / ${symbol.length} >= ${count}`,
  );
  return parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` and `)})`;
}

const RARITY_ORDER = sql`array['common', 'uncommon', 'rare', 'mythic']`;

function rarityCondition(comparison: Comparison, rarity: string): SQL {
  if (comparison === ":" || comparison === "=") return sql`p.rarity = ${rarity}`;
  if (comparison === "!=") return sql`p.rarity <> ${rarity}`;
  return sql`array_position(${RARITY_ORDER}, p.rarity) ${sql.raw(NUMERIC_OPERATORS[comparison])} array_position(${RARITY_ORDER}, ${rarity}::text)`;
}

function isCondition(value: string, context: SearchContext): SQL {
  if (value === "foil") {
    return sql`exists (select 1 from collection_cards owned_foil
                        where owned_foil.user_id = ${context.userId}
                          and owned_foil.printing_id = p.id
                          and owned_foil.finish in ('foil', 'etched'))`;
  }
  // is:commander mirrors canBeCommander in domain/rules.ts (test both when changing either).
  return sql`(
    (p.type_line ~ '\\mLegendary\\M' and p.type_line ~ '\\mCreature\\M')
    or (p.type_line ~ '\\mLegendary\\M' and p.type_line ~ '\\m(Vehicle|Spacecraft)\\M'
        and exists (select 1 from jsonb_array_elements(p.faces) face
                     where face->>'power' is not null and face->>'toughness' is not null))
    or exists (select 1 from jsonb_array_elements(p.faces) face
                where face->>'text' ~* 'can be your commander')
  )`;
}
