import { sql, type SQL } from "drizzle-orm";
import { COLOR_COMBINATIONS, colorCombination, type ManaColor, type UserId } from "@/shared/kernel";
import {
  manaSymbols,
  type ComparableField,
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
  /**
   * A deck with "Use my real cards" on (design doc 16): `own` counts real copies too. `real`
   * always counts only real copies.
   */
  ownIncludesReal?: boolean;
}>;

/** Store: the printing is sold in foil or etched. */
export const FOIL_IN_CATALOG = sql`p.finishes && array['foil', 'etched']::text[]`;

/** Collection: the copy in this row is foil or etched (`column` is its finish). */
export function foilCopy(column: SQL): SQL {
  return sql`${column} in ('foil', 'etched')`;
}

/**
 * Deck builder: the player owns a foil or etched copy of this printing (a real copy counts in a
 * deck that uses real cards, design doc 16).
 */
export function foilOwnedBy(userId: UserId, options: { includeReal?: boolean } = {}): SQL {
  const owns = (table: SQL) => sql`exists (select 1 from ${table} owned_foil
                      where owned_foil.user_id = ${userId}
                        and owned_foil.printing_id = p.id
                        and owned_foil.finish in ('foil', 'etched'))`;
  if (!options.includeReal) return owns(sql`collection_cards`);
  return sql`(${owns(sql`collection_cards`)} or ${owns(sql`real_cards`)})`;
}

/** SQL: how many copies of printing "p"'s card (any printing) the player has in `table`. */
function copiesOfCard(table: SQL, userId: UserId): SQL {
  return sql`(select coalesce(sum(owned.quantity), 0) from ${table} owned
               join printings owned_printing on owned_printing.id = owned.printing_id
              where owned.user_id = ${userId}
                and owned_printing.oracle_id = p.oracle_id)`;
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
 * A pattern as Postgres reads it. People (and LLMs) write `\b` for a word boundary, as in
 * JavaScript; in Postgres it means a backspace, and its word boundary is `\y`. An escaped
 * backslash (`\\b`) stays as written.
 */
export function forPostgres(pattern: string): string {
  return pattern.replace(/\\(.)/g, (escape, character: string) =>
    character === "b" ? "\\y" : escape,
  );
}

/**
 * How a text column matches the term: a case-insensitive regular expression (`~*`) for
 * /patterns/, else "contains" (ILIKE). The pattern was checked by the parser (length, syntax).
 */
function textMatch(column: SQL, term: SearchTerm): SQL {
  return term.isPattern === true
    ? sql`${column} ~* ${forPostgres(term.value)}`
    : sql`${column} ilike ${containing(term.value)}`;
}

function termCondition(term: SearchTerm, context: SearchContext): SQL {
  const { comparison, value } = term;
  if (term.compareTo !== undefined) return fieldComparison(term.field, comparison, term.compareTo);
  switch (term.field) {
    case "name":
      return textTerm(
        comparison === "=" && term.isPattern !== true
          ? sql`lower(p.name) = lower(${value})`
          : textMatch(sql`p.name`, term),
        comparison,
      );
    case "oracle":
      return textTerm(oracleCondition(term, { withReminders: false }), comparison);
    case "fullOracle":
      return textTerm(oracleCondition(term, { withReminders: true }), comparison);
    case "tag":
      return textTerm(sql`${value.toLowerCase()} = any(p.role_tags)`, comparison);
    case "theme":
      return textTerm(sql`${value.toLowerCase()} = any(p.theme_tags)`, comparison);
    case "banned":
    case "restricted":
      return textTerm(sql`p.legalities->>${value.toLowerCase()} = ${term.field}`, comparison);
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
    case "own": {
      const game = copiesOfCard(sql`collection_cards`, context.userId);
      const total = context.ownIncludesReal
        ? sql`(${game} + ${copiesOfCard(sql`real_cards`, context.userId)})`
        : game;
      return sql`${total} ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    }
    case "real":
      return sql`${copiesOfCard(sql`real_cards`, context.userId)}
                  ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
    case "color":
      // Scryfall's default for colors is "at least these" (c:rw finds Boros and Mardu cards).
      return colorCondition(sql`p.colors`, comparison === ":" ? ">=" : comparison, value);
    case "identity":
      // …and for identity, "within these" (id:rw finds what a Boros commander can play).
      return colorCondition(sql`p.color_identity`, comparison === ":" ? "<=" : comparison, value);
    case "manaValue":
      if (/^(even|odd)$/i.test(value)) {
        const remainder = value.toLowerCase() === "even" ? 0 : 1;
        return textTerm(sql`(p.mana_value::int % 2) = ${remainder}`, comparison);
      }
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

/** Reminder text: anything in parentheses. */
const REMINDER = String.raw`\([^)]*\)`;

/** A face's rules text, with or without reminder text. */
function faceText(withReminders: boolean): SQL {
  return withReminders
    ? sql`(face->>'text')`
    : sql`regexp_replace(face->>'text', ${REMINDER}, '', 'g')`;
}

/** Characters that mean something in a regular expression. */
const REGEX_SPECIALS = String.raw`([.^$*+?()\[\]{}|\\])`;

/** SQL: a text column with its regular-expression characters escaped. */
function escapedForPattern(text: SQL): SQL {
  return sql`regexp_replace(${text}, ${REGEX_SPECIALS}, ${String.raw`\\\1`}, 'g')`;
}

/** The same escaping in TypeScript, for plain words that become a pattern because of `~`. */
function escapeForPattern(text: string): string {
  return text.replace(/[.^$*+?()[\]{}|\\]/g, (character) => `\\${character}`);
}

/** How cards refer to themselves since late 2024 ("this creature"), besides their name. */
const SELF_WORDS = String.raw`this (creature|artifact|enchantment|land|planeswalker|battle|card|spell|permanent|token|vehicle|equipment|aura|saga|class|siege|room)`;

/**
 * Rules text matching a term (`o:` without reminder text, `fo:` with). A `~` stands for the
 * card's own name: the face's full name, its short name ("Jolene" for "Jolene, the Plunder
 * Queen"), or "this creature" and the like.
 */
function oracleCondition(term: SearchTerm, options: { withReminders: boolean }): SQL {
  const text = faceText(options.withReminders);
  if (!term.value.includes("~")) {
    return sql`exists (select 1 from jsonb_array_elements(p.faces) face
                        where ${textMatch(text, term)})`;
  }
  const source = term.isPattern === true ? forPostgres(term.value) : escapeForPattern(term.value);
  const faceName = sql`coalesce(face->>'name', p.name)`;
  const self = sql`'(' || ${escapedForPattern(faceName)} || '|'
                       || ${escapedForPattern(sql`split_part(${faceName}, ',', 1)`)} || '|'
                       || ${SELF_WORDS} || ')'`;
  return sql`exists (select 1 from jsonb_array_elements(p.faces) face
                      where ${text} ~* replace(${source}, '~', ${self}))`;
}

/** SQL for one number on the card: a face's (power, …) or the mana value. */
function cardNumber(field: ComparableField): SQL {
  return field === "manaValue" ? sql`p.mana_value` : sql`(face->>${field})::int`;
}

/** `pow>tou`: two numbers on the same face compared (faces without both numbers don't match). */
function fieldComparison(
  field: SearchTerm["field"],
  comparison: Comparison,
  other: ComparableField,
): SQL {
  const left = field as ComparableField; // the parser only allows comparable fields here
  const guards = [left, other]
    .filter((side) => side !== "manaValue")
    .map((side) => sql`face->>${side} ~ '^-?[0-9]+$'`);
  return sql`exists (select 1 from jsonb_array_elements(p.faces) face
                      where ${sql.join(guards, sql` and `)}
                        and ${cardNumber(left)} ${sql.raw(NUMERIC_OPERATORS[comparison])} ${cardNumber(other)})`;
}

/** Every rules text on the card without reminder text, one face per line. */
const PLAIN_RULES_TEXT = sql`coalesce((select string_agg(regexp_replace(face->>'text', ${REMINDER}, '', 'g'), ${"\n"})
                                          from jsonb_array_elements(p.faces) face), '')`;

/** How many basic land types the type line has (Plains, Island, …). */
const BASIC_TYPE_COUNT = sql`(select count(*) from unnest(array['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) basic(type_name)
                               where p.type_line ~ ('\\m' || basic.type_name || '\\M'))::int`;

/** A land whose rules text (no reminders) matches this pattern. */
function landSaying(pattern: string): SQL {
  return sql`(${hasType("Land")} and ${PLAIN_RULES_TEXT} ~* ${pattern})`;
}

const ENTERS_TAPPED = String.raw`enters( the battlefield)? tapped`;
const BASIC_NAME = String.raw`(plains|island|swamp|mountain|forest)`;

/** The common land cycles (design doc 28, section 3.6), from the type line and rules text. */
function landCycle(value: string): SQL | null {
  const land = hasType("Land");
  switch (value) {
    case "basic":
      return sql`(${land} and ${hasType("Basic")})`;
    case "fetchable":
      return sql`(${land} and ${BASIC_TYPE_COUNT} >= 1)`;
    case "dual":
      return sql`(${land} and not ${hasType("Basic")} and ${BASIC_TYPE_COUNT} = 2
                  and btrim(${PLAIN_RULES_TEXT}) = '')`;
    case "shockland":
      return sql`(${BASIC_TYPE_COUNT} = 2 and ${landSaying(String.raw`you may pay 2 life`)})`;
    case "fetchland":
      return landSaying(
        String.raw`pay 1 life, sacrifice [^:]*: search your library for an? \w+ or \w+ card`,
      );
    case "checkland":
      return landSaying(
        String.raw`${ENTERS_TAPPED} unless you control an? ${BASIC_NAME} or an? ${BASIC_NAME}`,
      );
    case "fastland":
      return landSaying(String.raw`${ENTERS_TAPPED} unless you control two or fewer other lands`);
    case "slowland":
      return landSaying(String.raw`${ENTERS_TAPPED} unless you control two or more other lands`);
    case "painland":
      return landSaying(
        String.raw`\{T\}: add \{[WUBRG]\} or \{[WUBRG]\}\.[^.\n]*deals 1 damage to you`,
      );
    case "bounceland":
      return landSaying(String.raw`return a land you control to its owner's hand`);
    case "scryland":
      return landSaying(
        String.raw`${ENTERS_TAPPED}\.\s*when [^.]*enters( the battlefield)?, scry 1`,
      );
    case "gainland":
      return landSaying(
        String.raw`${ENTERS_TAPPED}\.\s*when [^.]*enters( the battlefield)?, you gain 1 life`,
      );
    case "triome":
      return sql`(${land} and ${BASIC_TYPE_COUNT} = 3)`;
    case "cycleland":
      return sql`(${land} and ${BASIC_TYPE_COUNT} = 2
                  and exists (select 1 from unnest(p.keywords) keyword where lower(keyword) = 'cycling'))`;
    case "manland":
      return landSaying(String.raw`becomes an? [^.]*creature`);
    case "pathway":
      return sql`(p.layout = 'modal_dfc' and p.type_line ~ '^Land // Land$')`;
    default:
      return null;
  }
}

/** Creatures whose only rules text is keyword abilities (`Flying`, `Ward {2}`, …). */
const FRENCH_VANILLA = sql`(${hasType("Creature")}
  and btrim(${PLAIN_RULES_TEXT}) <> ''
  and not exists (
    select 1 from regexp_split_to_table(lower(${PLAIN_RULES_TEXT}), '[\n,]') part
     where btrim(part) <> ''
       and not exists (select 1 from unnest(p.keywords) keyword
                        where btrim(part) = lower(keyword) or btrim(part) like lower(keyword) || ' %')))`;

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
    case "frenchvanilla":
      return FRENCH_VANILLA;
    case "modal":
      return sql`${PLAIN_RULES_TEXT} ~* ${String.raw`\mchoose [a-z ]+ ?—`}`;
    case "party":
      return sql`(${hasType("Creature")} and p.type_line ~ '\\m(Cleric|Rogue|Warrior|Wizard)\\M')`;
    case "outlaw":
      return sql`(${hasType("Creature")} and p.type_line ~ '\\m(Assassin|Mercenary|Pirate|Rogue|Warlock)\\M')`;
    case "hybrid":
      return sql`coalesce(p.mana_cost, '') ~ ${String.raw`\{[WUBRGC2]/[WUBRG](/P)?\}`}`;
    case "phyrexian":
      return sql`coalesce(p.mana_cost, '') ~ ${String.raw`/P\}`}`;
    // Commander brackets (design doc 31).
    case "gamechanger":
    case "gc":
      return sql`p.is_game_changer`;
    case "landdenial":
      return sql`'landDenial' = any(p.bracket_flags)`;
    case "extraturn":
      return sql`'extraTurn' = any(p.bracket_flags)`;
    default:
      return landCycle(value) ?? sql`false`; // the parser refuses other values
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

/** SQL: printing "p" has exactly these colors. */
function hasExactly(colors: readonly ManaColor[]): SQL {
  const array = sql.join(
    colors.map((color) => sql`${color}`),
    sql`, `,
  );
  return sql`(cardinality(p.colors) = ${colors.length} and p.colors @> array[${array}]::text[])`;
}

/** SQL: a multicolored printing's combination, as `pick` gives it (its position or its label). */
function combinationOf(pick: (index: number, label: string) => SQL): SQL {
  const whens = COLOR_COMBINATIONS.map(
    (combination, index) =>
      sql`when ${hasExactly(combination.colors)} then ${pick(index, combination.label)}`,
  );
  return sql`(case ${sql.join(whens, sql` `)} end)`;
}

/**
 * How a collection page can be divided into sections, in SQL on printings aliased "p" and sets
 * aliased "s": [order, label] for each way (the game and real collections, design docs 7 and 16).
 */
export const COLLECTION_SECTIONS = {
  none: [sql`0`, sql`''`],
  // Binder order: each color, then each multicolored combination (guilds, shards, wedges, four
  // and five colors), colorless, and lands.
  color: [
    sql`case when p.type_line ~ '\\yLand\\y' and cardinality(p.colors) = 0 then 60
             when cardinality(p.colors) > 1 then ${combinationOf((index) => sql.raw(String(10 + index)))}
             when cardinality(p.colors) = 0 then 50
             else array_position(array['W','U','B','R','G'], p.colors[1]) end`,
    sql`case when p.type_line ~ '\\yLand\\y' and cardinality(p.colors) = 0 then 'Lands'
             when cardinality(p.colors) > 1 then ${combinationOf((_, label) => sql`${label}::text`)}
             when cardinality(p.colors) = 0 then 'Colorless'
             else (array['White','Blue','Black','Red','Green'])[array_position(array['W','U','B','R','G'], p.colors[1])] end`,
  ],
  // The first matching type, in the order players usually sort a collection.
  type: [
    sql`coalesce(array_position(array['Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land'],
          (select t from unnest(array['Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land']) with ordinality as types(t, n)
            where p.type_line ~ ('\\y' || t || '\\y') order by n limit 1)), 9)`,
    sql`coalesce((select t || 's' from unnest(array['Creature','Planeswalker','Instant','Sorcery','Artifact','Enchantment','Battle','Land']) with ordinality as types(t, n)
            where p.type_line ~ ('\\y' || t || '\\y') order by n limit 1), 'Other')`,
  ],
  rarity: [
    sql`coalesce(array_position(array['mythic','rare','uncommon','common'], p.rarity), 5)`,
    sql`initcap(p.rarity)`,
  ],
  set: [sql`0`, sql`s.name`],
} as const;

/**
 * SQL: printing "p" matches a collection page's color filter: "W", "U", "B", "R", "G" (includes
 * that color), "C" (colorless), "M" (multicolored), or a combination's code such as "GU" (exactly
 * those colors).
 */
export function colorFilter(color: string): SQL {
  const combination = colorCombination(color);
  if (color === "C") return sql`cardinality(p.colors) = 0`;
  if (color === "M") return sql`cardinality(p.colors) > 1`;
  if (combination) return hasExactly(combination.colors);
  return sql`${color} = any(p.colors)`;
}
