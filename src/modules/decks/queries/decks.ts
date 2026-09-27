import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import { BOARDS, DeckId, FORMATS, type Board, type Deck, type Format } from "../domain/deck";
import type { CardRules } from "../domain/rules";

// Read models for the deck screens (design doc 09, section 8). Ownership is counted by oracle
// card across every printing and finish (ADR 0011); basic lands never count as short (rule 1).

const IS_BASIC_LAND = sql`p.type_line ~ '^Basic\\y.*\\yLand\\y'`;

export type DeckSummary = Readonly<{
  id: number;
  name: string;
  format: Format;
  cards: number;
  short: number; // copies needed beyond what the player owns
  updatedAt: string;
}>;

/** A player's decks, most recently changed first, with how many cards each is short. */
export async function decksFor(db: DbExecutor, userId: UserId): Promise<DeckSummary[]> {
  const rows = await db.execute<{
    id: number;
    name: string;
    format: string;
    cards: number;
    short: number;
    updated_at: Date;
  }>(sql`
    with owned as (
      select p.oracle_id, sum(c.quantity) as quantity
        from collection_cards c join printings p on p.id = c.printing_id
       where c.user_id = ${userId}
       group by p.oracle_id
    ),
    basics as (select distinct p.oracle_id from printings p where ${IS_BASIC_LAND}),
    needs as (
      select e.deck_id, e.oracle_id, sum(e.quantity) as quantity
        from deck_entries e join decks d on d.id = e.deck_id
       where d.owner_id = ${userId}
       group by e.deck_id, e.oracle_id
    )
    select d.id, d.name, d.format, d.updated_at,
           coalesce((select sum(e.quantity) from deck_entries e where e.deck_id = d.id), 0)::int as cards,
           coalesce((select sum(greatest(0, n.quantity - coalesce(o.quantity, 0)))
                       from needs n left join owned o on o.oracle_id = n.oracle_id
                      where n.deck_id = d.id
                        and n.oracle_id not in (select oracle_id from basics)), 0)::int as short
      from decks d
     where d.owner_id = ${userId}
     order by d.updated_at desc, d.id desc
  `);
  return rows.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    format: z.enum(FORMATS).parse(row.format),
    cards: row.cards,
    short: row.short,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

/** One deck line with everything the builder shows. */
export type DeckLine = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  /** The printing to show and export: the pinned one, else one you own, else the newest. */
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  name: string;
  typeLine: string;
  manaValue: number;
  setCode: string;
  collectorNumber: string;
  owned: number;
  isBasicLand: boolean;
  /** Your other decks that also use this card (shared ownership, decided before the run). */
  otherDecks: string[];
}>;

export type DeckView = Readonly<{
  deck: Deck;
  lines: DeckLine[];
  rules: Readonly<Record<string, CardRules>>;
}>;

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

/** A player's deck, ready for the builder, or null if it isn't theirs. */
export async function deckView(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckView | null> {
  const [deckRow] = (
    await db.execute<{ id: number; owner_id: string; name: string; format: string }>(sql`
      select id, owner_id, name, format from decks where id = ${deckId} and owner_id = ${userId}
    `)
  ).rows;
  if (deckRow === undefined) return null;

  const rows = await db.execute<{
    oracle_id: string;
    board: string;
    quantity: number;
    pinned_printing: string | null;
    pinned_finish: string | null;
    printing_id: string;
    finish: string;
    name: string;
    type_line: string;
    mana_value: number;
    set_code: string;
    collector_number: string;
    is_basic_land: boolean;
    face_text: string;
    color_identity: string[];
    legalities: Record<string, string> | null;
    owned: number;
    other_decks: string[] | null;
  }>(sql`
    select e.oracle_id, e.board, e.quantity, e.printing_id as pinned_printing, e.finish as pinned_finish,
           shown.id as printing_id,
           coalesce(e.finish, owned_printing.finish,
                    case when 'nonfoil' = any(shown.finishes) then 'nonfoil' else shown.finishes[1] end) as finish,
           shown.name, shown.type_line, shown.mana_value, shown.set_code, shown.collector_number,
           newest.is_basic_land, newest.face_text, newest.color_identity, newest.legalities,
           coalesce((select sum(c.quantity) from collection_cards c join printings p on p.id = c.printing_id
                      where c.user_id = ${userId} and p.oracle_id = e.oracle_id), 0)::int as owned,
           (select array_agg(distinct d2.name) from deck_entries e2 join decks d2 on d2.id = e2.deck_id
             where d2.owner_id = ${userId} and e2.oracle_id = e.oracle_id and d2.id <> e.deck_id) as other_decks
      from deck_entries e
      -- The newest printing carries the current rules facts (legalities, identity).
      join lateral (
        select p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
               coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
               p.color_identity, p.legalities
          from printings p join card_sets s on s.code = p.set_code
         where p.oracle_id = e.oracle_id
         order by p.legalities is not null desc, s.release_date desc limit 1
      ) newest on true
      left join lateral (
        select c.printing_id, c.finish from collection_cards c join printings p on p.id = c.printing_id
         where c.user_id = ${userId} and p.oracle_id = e.oracle_id
         order by c.quantity desc limit 1
      ) owned_printing on true
      join lateral (
        select p.* from printings p join card_sets s on s.code = p.set_code
         where p.id = coalesce(e.printing_id, owned_printing.printing_id)
            or (e.printing_id is null and owned_printing.printing_id is null and p.oracle_id = e.oracle_id)
         order by s.release_date desc limit 1
      ) shown on true
     where e.deck_id = ${deckId}
     order by shown.mana_value, shown.name
  `);

  const rules: Record<string, CardRules> = {};
  const lines: DeckLine[] = rows.rows.map((row) => {
    rules[row.oracle_id] = {
      name: row.name,
      typeLine: row.type_line,
      text: row.face_text,
      colorIdentity: row.color_identity.map((color) => ColorSchema.parse(color)),
      legalities: row.legalities ?? {},
      isBasicLand: row.is_basic_land,
    };
    return {
      oracleId: row.oracle_id,
      board: z.enum(BOARDS).parse(row.board),
      quantity: row.quantity,
      printingId: row.printing_id,
      finish: FinishSchema.parse(row.finish),
      name: row.name,
      typeLine: row.type_line,
      manaValue: Number(row.mana_value),
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      owned: row.owned,
      isBasicLand: row.is_basic_land,
      otherDecks: row.other_decks ?? [],
    };
  });

  const deck: Deck = {
    id: DeckId.of(Number(deckRow.id)),
    ownerId: UserId.of(deckRow.owner_id),
    name: deckRow.name,
    format: z.enum(FORMATS).parse(deckRow.format),
    entries: rows.rows.map((row) => ({
      oracleId: row.oracle_id,
      board: z.enum(BOARDS).parse(row.board),
      quantity: row.quantity,
      printingId: null,
      finish: null,
    })),
  };
  return { deck, lines, rules };
}

export type OwnedCardMatch = Readonly<{
  oracleId: string;
  name: string;
  owned: number;
  printingId: string; // the printing you have most copies of
  finish: "nonfoil" | "foil" | "etched";
}>;

/** Cards in a player's collection whose name contains `name`, one line per oracle card. */
export async function ownedCardsNamed(
  db: DbExecutor,
  userId: UserId,
  name: string,
  limit = 30,
): Promise<OwnedCardMatch[]> {
  if (name.trim() === "") return [];
  const rows = await db.execute<{
    oracle_id: string;
    name: string;
    owned: number;
    printing_id: string;
    finish: string;
  }>(sql`
    select p.oracle_id, min(p.name) as name, sum(c.quantity)::int as owned,
           (array_agg(c.printing_id order by c.quantity desc))[1] as printing_id,
           (array_agg(c.finish order by c.quantity desc))[1] as finish
      from collection_cards c join printings p on p.id = c.printing_id
     where c.user_id = ${userId} and p.name ilike ${`%${name.trim()}%`}
     group by p.oracle_id
     -- Names that start with what was typed come first ("swa" → Swamp before Muck Swamp).
     order by lower(min(p.name)) like lower(${`${name.trim()}%`}) desc, min(p.name)
     limit ${limit}
  `);
  return rows.rows.map((row) => ({
    oracleId: row.oracle_id,
    name: row.name,
    owned: row.owned,
    printingId: row.printing_id,
    finish: FinishSchema.parse(row.finish),
  }));
}

export type DeckRef = Readonly<{ id: number; name: string; quantity: number }>;

/**
 * For each printing, the player's decks that use its card (any printing of it counts: decks go by
 * oracle card). Lets the collection say where a copy is, so you know which deck to pull it from.
 */
export async function decksUsing(
  db: DbExecutor,
  userId: UserId,
  printingIds: readonly string[],
): Promise<Map<string, DeckRef[]>> {
  if (printingIds.length === 0) return new Map();
  const rows = await db.execute<{
    printing_id: string;
    deck_id: number;
    name: string;
    quantity: number;
  }>(sql`
    select p.id as printing_id, d.id as deck_id, d.name, sum(e.quantity)::int as quantity
      from printings p
      join deck_entries e on e.oracle_id = p.oracle_id
      join decks d on d.id = e.deck_id and d.owner_id = ${userId}
     where p.id = any(${sql.param([...new Set(printingIds)])}::text[])
     group by p.id, d.id, d.name
     order by d.name
  `);
  const found = new Map<string, DeckRef[]>();
  for (const row of rows.rows) {
    found.set(row.printing_id, [
      ...(found.get(row.printing_id) ?? []),
      { id: Number(row.deck_id), name: row.name, quantity: row.quantity },
    ]);
  }
  return found;
}
