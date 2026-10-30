import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { FORMATS } from "../domain/deck";
import type { CardRules } from "../domain/rules";
import { parseSearch } from "@/shared/card-search";
import { foilOwnedBy, searchCondition } from "@/shared/card-search/sql";
import { ownedCopies } from "./owned";

// Browsing your collection while building a deck (design doc 14, section 2.1): one entry per
// card you own (shown as the printing you have most copies of), with what the deck needs to know.

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);
/** A color of Magic: "W", "U", "B", "R" or "G". */
type Color = z.infer<typeof ColorSchema>;

export const BROWSE_PAGE_SIZE = 60;
export const BROWSE_SORTS = ["name", "manaValue", "color", "type", "newest"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];

export type BrowseInput = Readonly<{
  deckId: number;
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
  /** Copies counted as owned in this deck: game copies, plus real ones when it uses them. */
  owned: number;
  /** How many of `owned` are real copies (design doc 16). */
  ownedReal: number;
  inThisDeck: number;
  /** How many of your other decks use this card (ownership is shared between decks). */
  otherDecks: number;
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

const ORDER: Readonly<Record<BrowseSort, SQL>> = {
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
  newest: sql`owned.newest desc nulls last, p.name`,
};

/** One page of the cards you own that match the search and colors, for one of your decks. */
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
    fits_identity: boolean;
    is_legal: boolean;
    color_identity: string[];
    legality: string | null;
    face_text: string;
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
             (array_agg(c.printing_id order by c.quantity desc, c.printing_id))[1] as printing_id,
             (select max(a.created_at) from acquisitions a
               join printings ap on ap.id = a.printing_id
              where a.user_id = ${userId} and ap.oracle_id = p.oracle_id) as newest
        from ${owned} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    )
    select owned.oracle_id, p.id as printing_id, p.name, p.mana_cost, p.mana_value, p.type_line,
           owned.owned, owned.owned_real,
           coalesce((select sum(e.quantity) from deck_entries e
                      where e.deck_id = ${input.deckId} and e.oracle_id = owned.oracle_id), 0)::int
             as in_this_deck,
           (select count(distinct e.deck_id) from deck_entries e join decks d on d.id = e.deck_id
             where d.owner_id = ${userId} and d.id <> ${input.deckId}
               and e.oracle_id = owned.oracle_id)::int as other_decks,
           ${identityFits} as fits_identity,
           ${legal} as is_legal,
           p.color_identity, p.legalities->>${context.format} as legality,
           coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
           exists (select 1 from jsonb_array_elements(p.faces) f
                    where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
           p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
           p.produced_mana, p.set_code, p.collector_number, shown.finish,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = p.id and s.finish = shown.finish
             order by s.day desc limit 1) as price_cents,
           count(*) over ()::int as total
      from owned join printings p on p.id = owned.printing_id
      -- The finish a new deck line shows, as the deck view picks it when nothing is pinned.
      cross join lateral (
        select coalesce(
                 (select c.finish from ${owned} c
                   where c.printing_id = p.id
                   order by c.quantity desc limit 1),
                 case when 'nonfoil' = any(p.finishes) then 'nonfoil' else p.finishes[1] end
               ) as finish
      ) shown
     where ${searchCondition(parsed.node, {
       userId,
       foil: foilOwnedBy(userId, { includeReal: context.usesRealCards }),
       ownIncludesReal: context.usesRealCards,
     })} and ${colorFilter}
       and (${!input.onlyLegal} or ${legal})
     order by ${ORDER[input.sort]}
     limit ${BROWSE_PAGE_SIZE} offset ${offset}
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
