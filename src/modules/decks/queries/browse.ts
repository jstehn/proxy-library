import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { FORMATS } from "../domain/deck";
import type { CardRules } from "../domain/rules";
import { parseSearch } from "@/shared/card-search";
import { foilOwnedBy, searchCondition } from "@/shared/card-search/sql";
import { MOST_SPECIAL_FIRST, ownedCopies, STANDARD_FIRST } from "./owned";

// Browsing cards while building a deck (design doc 14, section 2.1): one entry per card, with
// what the deck needs to know. The grid searches either the cards you own or every card for sale
// (design doc 29). Your cards are shown as your most special copy, others as their standard art.

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);
/** A color of Magic: "W", "U", "B", "R" or "G". */
type Color = z.infer<typeof ColorSchema>;

export const BROWSE_PAGE_SIZE = 60;
export const BROWSE_SORTS = ["name", "manaValue", "color", "type", "newest"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];
/** What the grid searches: the cards you own, or every card for sale (design doc 29). */
export const BROWSE_SOURCES = ["mine", "all"] as const;
export type BrowseSource = (typeof BROWSE_SOURCES)[number];

export type BrowseInput = Readonly<{
  deckId: number;
  source: BrowseSource;
  search: string;
  /**
   * Show only cards whose color identity is within these colors; null shows every color. A
   * Commander deck starts with its commander's colors (design doc 14, decision 2).
   */
  colors: readonly Color[] | null;
  /** Whether colorless cards are shown (only matters when `colors` is set). */
  includeColorless: boolean;
  /** Whether cards that aren't legal in the deck's format are left out (the default view). */
  onlyLegal: boolean;
  sort: BrowseSort;
  page: number; // from 1
}>;

export type BrowseCard = Readonly<{
  oracleId: string;
  printingId: string;
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  /**
   * Copies counted as owned in this deck: game copies, plus real ones when it uses them. Zero for
   * a card you don't own (only when browsing every card).
   */
  owned: number;
  /** How many of `owned` are real copies (design doc 16). */
  ownedReal: number;
  inThisDeck: number;
  /** How many of your other decks use this card (ownership is shared between decks). */
  otherDecks: number;
  /** Copies owned that none of your other decks uses (task 42). */
  free: number;
  /** Why it doesn't fit this deck, or null if it does. */
  misfit: "color" | "legality" | null;
  /**
   * What the deck rules need, so the builder can check a card the moment it's added (design doc
   * 19, section 5.3). Legalities hold only the deck's format.
   */
  rules: CardRules;
  /** The rest of a provisional deck line, shown until the server answers. */
  producedMana: string[];
  text: string;
  /** On Wizards' Game Changer list (design doc 31). */
  isGameChanger: boolean;
  setCode: string;
  collectorNumber: string;
  finish: "nonfoil" | "foil" | "etched";
  priceCents: number | null;
}>;

export type BrowsePage = Readonly<{
  cards: readonly BrowseCard[];
  total: number;
  pageCount: number;
  /** Parts of the search that were ignored, to show under the box. */
  notes: readonly string[];
}>;

/** The deck's format and its commanders' combined color identity (null without commanders). */
export async function deckBrowseContext(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<{
  format: (typeof FORMATS)[number];
  commanderColors: Color[] | null;
  usesRealCards: boolean;
} | null> {
  const [row] = (
    await db.execute<{
      format: string;
      colors: string[] | null;
      commanders: number;
      uses_real_cards: boolean;
    }>(sql`
      select d.format, d.uses_real_cards,
             (select array_agg(distinct color) from deck_entries e
                join lateral (select p.color_identity from printings p
                               where p.oracle_id = e.oracle_id limit 1) card on true
                cross join unnest(card.color_identity) as color
               where e.deck_id = d.id and e.board = 'commander') as colors,
             (select count(*)::int from deck_entries e
               where e.deck_id = d.id and e.board = 'commander') as commanders
        from decks d where d.id = ${deckId} and d.owner_id = ${userId}
    `)
  ).rows;
  if (row === undefined) return null;
  const format = z.enum(FORMATS).parse(row.format);
  const commanderColors =
    format === "commander" && row.commanders > 0
      ? (row.colors ?? []).map((color) => ColorSchema.parse(color))
      : null;
  return { format, commanderColors, usesRealCards: row.uses_real_cards };
}

/**
 * The grid's ORDER BY for a printing "p" of each card. `newest` is the card's "newest" date (when
 * you last got one, or for every card the newest set it's in), and `oracleId` breaks name ties so
 * no card lands on two pages.
 */
function orderBy(sort: BrowseSort, newest: SQL, oracleId: SQL): SQL {
  const keys: Record<BrowseSort, SQL> = {
    name: sql`p.name`,
    manaValue: sql`p.mana_value, p.name`,
    color: sql`cardinality(p.color_identity) = 0, cardinality(p.color_identity),
               array_to_string(p.color_identity, ''), p.name`,
    // The deck list's type order (domain/stats.ts TYPE_ORDER), so the grid can show type headings.
    type: sql`case
                when p.type_line ~ '\\mCreature\\M' then 0
                when p.type_line ~ '\\mPlaneswalker\\M' then 1
                when p.type_line ~ '\\mInstant\\M' then 2
                when p.type_line ~ '\\mSorcery\\M' then 3
                when p.type_line ~ '\\mArtifact\\M' then 4
                when p.type_line ~ '\\mEnchantment\\M' then 5
                when p.type_line ~ '\\mBattle\\M' then 6
                when p.type_line ~ '\\mLand\\M' then 7
                else 8 end, p.mana_value, p.name`,
    newest: sql`${newest} desc nulls last, p.name`,
  };
  return sql`${keys[sort]}, ${oracleId}`;
}

/** One page of the cards that match the search and colors, for one of your decks. */
export async function browseCollection(
  db: DbExecutor,
  userId: UserId,
  input: BrowseInput,
): Promise<BrowsePage | null> {
  const context = await deckBrowseContext(db, userId, input.deckId);
  if (context === null) return null;
  const parsed = parseSearch(input.search);

  const colorFilter =
    input.colors === null
      ? sql`true`
      : sql`p.color_identity <@ array[${sql.join(
          [...input.colors, "_"].map((color) => sql`${color}`),
          sql`, `,
        )}]::text[]
            and (${input.includeColorless} or cardinality(p.color_identity) > 0)`;
  const identityFits =
    context.commanderColors === null
      ? sql`true`
      : sql`p.color_identity <@ array[${sql.join(
          [...context.commanderColors, "_"].map((color) => sql`${color}`),
          sql`, `,
        )}]::text[]`;
  const legal =
    context.format === "casual"
      ? sql`true`
      : sql`coalesce(p.legalities->>${context.format}, 'legal') in ('legal', 'restricted')`;
  const offset = (Math.max(1, input.page) - 1) * BROWSE_PAGE_SIZE;
  // The cards you own for this deck: real ones too when it uses them (design doc 16, rule 2).
  const owned = ownedCopies(userId, sql`${context.usesRealCards}`);
  // What a printing "p" must satisfy to be in the grid.
  const matches = sql`${searchCondition(parsed.node, {
    userId,
    foil: foilOwnedBy(userId, { includeReal: context.usesRealCards }),
    ownIncludesReal: context.usesRealCards,
    deckId: input.deckId,
  })} and ${colorFilter} and (${!input.onlyLegal} or ${legal})`;

  // One page of candidates: (oracle_id, printing_id shown, owned, owned_real, newest, total).
  // Your cards: the printing shown is your most special copy, and it's the one searched.
  const mineCandidates = sql`
    candidates as (
      select owned.oracle_id, owned.printing_id, owned.owned, owned.owned_real, owned.newest,
             count(*) over ()::int as total
        from owned join printings p on p.id = owned.printing_id
       where ${matches}
       order by ${orderBy(input.sort, sql`owned.newest`, sql`owned.oracle_id`)}
       limit ${BROWSE_PAGE_SIZE} offset ${offset}
    )`;
  // Every card for sale (design doc 29, section 9): group the matching printings by card, page
  // the groups, and only then choose a printing for each of the 60 cards on the page.
  const allCandidates = sql`
    matching as (
      -- One row per card: its newest matching printing. Every printing of a card has the same
      -- name, mana value, colors and types, so this row can sort the card, and it carries only
      -- the columns sorting needs (a narrow sort stays in memory).
      select distinct on (p.oracle_id)
             p.oracle_id, p.name, p.mana_value, p.color_identity, p.type_line,
             s.release_date as newest
        from printings p join card_sets s on s.code = p.set_code and s.is_enabled
       where ${matches}
       order by p.oracle_id, s.release_date desc nulls last
    ),
    paged as (
      -- "p" here is the matching row, so the grid's ORDER BY (written for a printing) applies.
      select p.oracle_id, p.newest, count(*) over ()::int as total
        from matching p
       order by ${orderBy(input.sort, sql`p.newest`, sql`p.oracle_id`)}
       limit ${BROWSE_PAGE_SIZE} offset ${offset}
    ),
    candidates as (
      select paged.oracle_id,
             -- Yours: your most special copy (rule 3). Otherwise the standard art among the
             -- printings that match, so "s:mh3" shows the MH3 one (design doc 24, rule 2).
             coalesce(owned.printing_id, (
               select p.id from printings p join card_sets s on s.code = p.set_code and s.is_enabled
                where p.oracle_id = paged.oracle_id and ${matches}
                order by ${STANDARD_FIRST} limit 1)) as printing_id,
             coalesce(owned.owned, 0) as owned, coalesce(owned.owned_real, 0) as owned_real,
             paged.newest, paged.total
        from paged left join owned on owned.oracle_id = paged.oracle_id
    )`;

  const rows = await db.execute<{
    oracle_id: string;
    printing_id: string;
    name: string;
    mana_cost: string | null;
    mana_value: number;
    type_line: string;
    owned: number;
    owned_real: number;
    in_this_deck: number;
    other_decks: number;
    free: number;
    fits_identity: boolean;
    is_legal: boolean;
    color_identity: string[];
    legality: string | null;
    face_text: string;
    is_game_changer: boolean;
    has_power_toughness: boolean;
    is_basic_land: boolean;
    produced_mana: string[] | null;
    set_code: string;
    collector_number: string;
    finish: string;
    price_cents: number | null;
    total: number;
  }>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity)::int as owned,
             coalesce(sum(c.quantity) filter (where c.is_real), 0)::int as owned_real,
             -- Your most special copy is the one shown and added (design doc 23, section 14).
             (array_agg(c.printing_id order by ${MOST_SPECIAL_FIRST}))[1] as printing_id,
             (select max(a.created_at) from acquisitions a
               join printings ap on ap.id = a.printing_id
              where a.user_id = ${userId} and ap.oracle_id = p.oracle_id) as newest
        from ${owned} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    ),
    ${input.source === "mine" ? mineCandidates : allCandidates}
    select card.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value, p.type_line,
           card.owned, card.owned_real,
           coalesce((select sum(e.quantity) from deck_entries e
                      where e.deck_id = ${input.deckId} and e.oracle_id = card.oracle_id
                        and e.board <> 'maybe'), 0)::int
             as in_this_deck,
           (select count(distinct e.deck_id) from deck_entries e join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${input.deckId}
               and e.oracle_id = card.oracle_id and e.board <> 'maybe')::int as other_decks,
           greatest(card.owned - coalesce((select sum(e.quantity) from deck_entries e
                                             join decks d on d.id = e.deck_id
                                            where d.owner_id = ${userId} and d.id <> ${input.deckId}
                                              and e.oracle_id = card.oracle_id
                                              and e.board <> 'maybe'), 0), 0)::int as free,
           ${identityFits} as fits_identity,
           ${legal} as is_legal,
           p.color_identity, p.legalities->>${context.format} as legality,
           coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
           exists (select 1 from jsonb_array_elements(p.faces) f
                    where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
           p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
           p.produced_mana, p.is_game_changer, p.set_code, p.collector_number, shown.finish,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = p.id and s.finish = shown.finish
             order by s.day desc limit 1) as price_cents,
           card.total
      from candidates card join printings p on p.id = card.printing_id
      -- The finish a new deck line shows, as the deck view picks it when nothing is pinned: your
      -- most special copy's, or nonfoil for a card you don't own (design doc 29, rule 4).
      cross join lateral (
        select coalesce(
                 (select c.finish from ${owned} c
                   where c.printing_id = p.id
                   order by ${MOST_SPECIAL_FIRST} limit 1),
                 case when 'nonfoil' = any(p.finishes) then 'nonfoil' else p.finishes[1] end
               ) as finish
      ) shown
     order by ${orderBy(input.sort, sql`card.newest`, sql`card.oracle_id`)}
  `);

  const total = rows.rows[0]?.total ?? 0;
  return {
    cards: rows.rows.map((row) => ({
      oracleId: row.oracle_id,
      printingId: row.printing_id,
      name: row.name,
      manaCost: row.mana_cost,
      manaValue: Number(row.mana_value),
      typeLine: row.type_line,
      owned: row.owned,
      ownedReal: row.owned_real,
      inThisDeck: row.in_this_deck,
      otherDecks: row.other_decks,
      free: row.free,
      misfit: !row.fits_identity ? "color" : !row.is_legal ? "legality" : null,
      rules: {
        name: row.name,
        typeLine: row.type_line,
        text: row.face_text,
        colorIdentity: row.color_identity.map((color) => ColorSchema.parse(color)),
        legalities: row.legality === null ? {} : { [context.format]: row.legality },
        isBasicLand: row.is_basic_land,
        hasPowerToughness: row.has_power_toughness,
      },
      producedMana: row.produced_mana ?? [],
      text: row.face_text,
      isGameChanger: row.is_game_changer,
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      finish: FinishSchema.parse(row.finish),
      priceCents: row.price_cents === null ? null : Number(row.price_cents),
    })),
    total,
    pageCount: Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE)),
    notes: parsed.notes,
  };
}
