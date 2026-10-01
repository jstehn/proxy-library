import { sql, type SQL } from "drizzle-orm";
import type { UserId } from "@/shared/kernel";
import {
  manaSymbols,
  parseColors,
  rarityName,
  type Comparison,
  type SearchNode,
  type SearchTerm,
} from "./parse";

// Turns a parsed search (./parse.ts) into SQL conditions on printings aliased "p" (design docs
// 14 and 15). Every value is a parameter: nothing typed is pasted into SQL. Server code only.

/**
 * What a search runs over. The same words mean slightly different things on each page:
 * `is:foil` is "comes in foil" in the store, "this copy is foil" in the collection, and "I own
 * a foil copy" in the deck builder.
 */
export type SearchContext = Readonly<{
  /** The player searching (for `own` and owned foils). */
  userId: UserId;
  /** The SQL that answers `is:foil` here: one of the FOIL_* helpers below. */
  foil: SQL;
}>;

/** Store: the printing is sold in foil or etched. */
export const FOIL_IN_CATALOG = sql`p.finishes && array['foil', 'etched']::text[]`;

/** Collection: the copy in this row is foil or etched (`column` is its finish). */
export function foilCopy(column: SQL): SQL {
  return sql`${column} in ('foil', 'etched')`;
}

/** Deck builder: the player owns a foil or etched copy of this printing. */
export function foilOwnedBy(userId: UserId): SQL {
  return sql`exists (select 1 from collection_cards owned_foil
                      where owned_foil.user_id = ${userId}
                        and owned_foil.printing_id = p.id
                        and owned_foil.finish in ('foil', 'etched'))`;
}

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

/**
 * How a text column matches the term: a case-insensitive regular expression (`~*`) for
 * /patterns/, else "contains" (ILIKE). The pattern was checked by the parser (length, syntax).
 */
function textMatch(column: SQL, term: SearchTerm): SQL {
  return term.isPattern === true
    ? sql`${column} ~* ${term.value}`
    : sql`${column} ilike ${containing(term.value)}`;
}

function termCondition(term: SearchTerm, context: SearchContext): SQL {
  const { comparison, value } = term;
  switch (term.field) {
    case "name":
      return textTerm(
        comparison === "=" && term.isPattern !== true
          ? sql`lower(p.name) = lower(${value})`
          : textMatch(sql`p.name`, term),
        comparison,
      );
    case "oracle":
      return textTerm(
        sql`exists (select 1 from jsonb_array_elements(p.faces) face
                     where ${textMatch(sql`(face->>'text')`, term)})`,
        comparison,
      );
    case "type":
      return textTerm(textMatch(sql`p.type_line`, term), comparison);
    case "artist":
      return textTerm(textMatch(sql`coalesce(p.artist, '')`, term), comparison);
    case "keyword":
      return textTerm(
        sql`exists (select 1 from unnest(p.keywords) keyword where lower(keyword) = lower(${value}))`,
        comparison,
      );
    case "loyalty":
    case "defense":
      return faceNumber(term.field, comparison, value);
    case "number":
      return comparison === ":" || comparison === "=" || comparison === "!="
        ? textTerm(sql`lower(p.collector_number) = lower(${value})`, comparison)
        : sql`nullif(regexp_replace(p.collector_number, '[^0-9]', '', 'g'), '')::int ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    case "produces":
      return textTerm(
        sql`p.produced_mana @> ${sql`array[${sql.join(
          [...new Set(value.toUpperCase())].map((color) => sql`${color}`),
          sql`, `,
        )}]::text[]`}`,
        comparison,
      );
    case "usd":
      // The cheapest current market price among the printing's finishes, in dollars.
      return sql`(select min(latest.usd_cents) from (
                    select distinct on (s.finish) s.usd_cents from price_snapshots s
                     where s.printing_id = p.id order by s.finish, s.day desc) latest)
                  ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Math.round(Number(value) * 100)}`;
    case "year":
      return sql`left((select release_date from card_sets where code = p.set_code), 4)::int
                  ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    case "date":
      // Dates are "YYYY-MM-DD" text, so a shorter value compares by its prefix.
      return sql`left((select release_date from card_sets where code = p.set_code), ${value.length})
                  ${sql.raw(NUMERIC_OPERATORS[comparison])} ${value}`;
    case "border":
      return textTerm(sql`p.border_color = ${value.toLowerCase()}`, comparison);
    case "frame": {
      const frame = value.toLowerCase();
      return textTerm(
        sql`(p.frame_version = ${frame} or ${frame} = any(p.frame_effects))`,
        comparison,
      );
    }
    case "own":
      return sql`(select coalesce(sum(owned.quantity), 0) from collection_cards owned
                    join printings owned_printing on owned_printing.id = owned.printing_id
                   where owned.user_id = ${context.userId}
                     and owned_printing.oracle_id = p.oracle_id)
                  ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    case "color":
      // Scryfall's default for colors is "at least these" (c:rw finds Boros and Mardu cards).
      return colorCondition(sql`p.colors`, comparison === ":" ? ">=" : comparison, value);
    case "identity":
      // …and for identity, "within these" (id:rw finds what a Boros commander can play).
      return colorCondition(sql`p.color_identity`, comparison === ":" ? "<=" : comparison, value);
    case "manaValue":
      return sql`p.mana_value ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    case "power":
    case "toughness":
      return faceNumber(term.field, comparison, value);
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

/** A number printed on a card face (power, toughness, loyalty, defense), compared. */
function faceNumber(key: string, comparison: Comparison, value: string): SQL {
  return sql`exists (select 1 from jsonb_array_elements(p.faces) face
                      where face->>${key} ~ '^-?[0-9]+$'
                        and (face->>${key})::int ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)})`;
}

/** Whether the type line has this word (whole words: "Creature", not "Creatures"). */
function hasType(word: string): SQL {
  return sql`p.type_line ~ ${`\\m${word}\\M`}`;
}

/** Every rules text on the card, joined (empty for vanilla cards). */
const RULES_TEXT = sql`coalesce((select string_agg(face->>'text', '') from jsonb_array_elements(p.faces) face), '')`;

function isCondition(value: string, context: SearchContext): SQL {
  switch (value) {
    case "foil":
      return context.foil;
    case "etched":
      return sql`'etched' = any(p.finishes)`;
    // Layouts. "dfc" is any card with a back face of its own.
    case "dfc":
      return sql`p.layout in ('transform', 'modal_dfc', 'meld', 'reversible_card')`;
    case "transform":
    case "split":
    case "adventure":
    case "flip":
    case "meld":
    case "saga":
    case "class":
      return sql`p.layout = ${value}`;
    case "mdfc":
      return sql`p.layout = 'modal_dfc'`;
    // Treatments.
    case "showcase":
    case "extendedart":
      return sql`${value} = any(p.frame_effects)`;
    case "fullart":
      return sql`p.is_full_art`;
    case "borderless":
      return sql`p.border_color = 'borderless'`;
    case "serialized":
      return sql`'serialized' = any(p.promo_types)`;
    case "promo":
      return sql`(cardinality(p.promo_types) > 0 and not p.promo_types <@ array['boosterfun', 'universesbeyond']::text[])`;
    // Kinds of card.
    case "permanent":
      return sql`not (${hasType("Instant")} or ${hasType("Sorcery")})`;
    case "spell":
      return sql`not ${hasType("Land")}`;
    case "legendary":
      return hasType("Legendary");
    case "historic":
      return sql`(${hasType("Legendary")} or ${hasType("Artifact")} or ${hasType("Saga")})`;
    case "vanilla":
      return sql`(${hasType("Creature")} and ${RULES_TEXT} = '')`;
    case "bear":
      return sql`(${hasType("Creature")} and p.mana_value = 2
                  and exists (select 1 from jsonb_array_elements(p.faces) face
                               where face->>'power' = '2' and face->>'toughness' = '2'))`;
    case "commander":
      return commanderCondition();
    default:
      return sql`false`; // the parser refuses other values
  }
}

// is:commander mirrors canBeCommander in decks/domain/rules.ts (test both when changing either).
function commanderCondition(): SQL {
  return sql`(
    (p.type_line ~ '\\mLegendary\\M' and p.type_line ~ '\\mCreature\\M')
    or (p.type_line ~ '\\mLegendary\\M' and p.type_line ~ '\\m(Vehicle|Spacecraft)\\M'
        and exists (select 1 from jsonb_array_elements(p.faces) face
                     where face->>'power' is not null and face->>'toughness' is not null))
    or exists (select 1 from jsonb_array_elements(p.faces) face
                where face->>'text' ~* 'can be your commander')
  )`;
}
