import { sql } from "drizzle-orm";
import { z } from "zod";
import { type DbExecutor } from "@/shared/db";
import { ColorSchema, UserId } from "@/shared/kernel";
import { DeckOrigin, FORMATS, VISIBILITIES, type Format, type Visibility } from "../domain/deck";
import type { DeckSource } from "../domain/deck-view";
import type { CardRules } from "../domain/rules";
import { ownedCopies } from "./owned";

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
  /** Set when the app made the deck: a finished draft (design doc 17). */
  origin: DeckOrigin | null;
  /** Whether the playgroup can see it (design doc 21). */
  visibility: Visibility;
  /** "Use my real cards" (design doc 16). */
  usesRealCards: boolean;
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
    origin: string | null;
    visibility: string;
    uses_real_cards: boolean;
  }>(sql`
    with owned as (
      select p.oracle_id,
             sum(c.quantity) filter (where not c.is_real) as game,
             sum(c.quantity) filter (where c.is_real) as real
        from ${ownedCopies(userId, sql`true`)} c join printings p on p.id = c.printing_id
       group by p.oracle_id
    ),
    basics as (select distinct p.oracle_id from printings p where ${IS_BASIC_LAND}),
    needs as (
      select e.deck_id, e.oracle_id, sum(e.quantity) as quantity
        from deck_entries e join decks d on d.id = e.deck_id
       where d.owner_id = ${userId} and e.board <> 'maybe'
       group by e.deck_id, e.oracle_id
    )
    select d.id, d.name, d.format, d.updated_at, d.origin, d.visibility, d.uses_real_cards,
           coalesce((select sum(e.quantity) from deck_entries e
                      where e.deck_id = d.id and e.board <> 'maybe'), 0)::int as cards,
           -- Real copies count only in decks with the switch on (design doc 16, rule 2).
           coalesce((select sum(greatest(0, n.quantity - coalesce(o.game, 0)
                                            - case when d.uses_real_cards then coalesce(o.real, 0) else 0 end))
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
    origin: DeckOrigin.parse(row.origin),
    visibility: z.enum(VISIBILITIES).parse(row.visibility),
    usesRealCards: row.uses_real_cards,
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
      join deck_entries e on e.oracle_id = p.oracle_id and e.board <> 'maybe'
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

/** Saved research sources for one of the player's decks, newest first. */
export async function listDeckSources(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckSource[] | null> {
  const [owned] = (
    await db.execute<{ id: number }>(
      sql`select id from decks where id = ${deckId} and owner_id = ${userId}`,
    )
  ).rows;
  if (owned === undefined) return null;

  const rows = await db.execute<{
    id: number;
    url: string;
    title: string;
    used_for: string;
    added_at: Date;
  }>(sql`
    select id, url, title, used_for, added_at
      from deck_sources
     where deck_id = ${deckId}
     order by added_at desc, id desc
  `);

  return rows.rows.map((r) => ({
    id: Number(r.id),
    url: r.url,
    title: r.title,
    usedFor: r.used_for,
    addedAt: new Date(r.added_at).toISOString(),
  }));
}

/** Adds a research source to one of the player's decks and returns all saved sources. */
export async function addDeckSource(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  source: { url: string; title: string; usedFor: string },
  at: Date,
): Promise<DeckSource[] | null> {
  const [owned] = (
    await db.execute<{ id: number }>(
      sql`select id from decks where id = ${deckId} and owner_id = ${userId}`,
    )
  ).rows;
  if (owned === undefined) return null;

  await db.execute(sql`
    insert into deck_sources (deck_id, url, title, used_for, added_at)
    values (${deckId}, ${source.url}, ${source.title}, ${source.usedFor}, ${at})
  `);

  return listDeckSources(db, userId, deckId);
}

/** One precon deck list's commanders, as the deck rules see them (for `check-commanders`). */
export type PreconCommanders = Readonly<{
  setCode: string;
  deckName: string;
  commanders: CardRules[];
}>;

/** Every deck list in the catalog that has a commander board, with its commanders' rules facts. */
export async function preconCommanders(db: DbExecutor): Promise<PreconCommanders[]> {
  const rows = await db.execute<{
    set_code: string;
    deck_name: string;
    name: string;
    type_line: string;
    face_text: string;
    has_power_toughness: boolean;
    color_identity: string[];
    legalities: Record<string, string> | null;
  }>(sql`
    select d.set_code, d.name as deck_name, p.name, p.type_line,
           coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
           exists (select 1 from jsonb_array_elements(p.faces) f
                    where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
           p.color_identity, p.legalities
      from deck_lists d
      cross join jsonb_array_elements(d.cards) as card
      join printings p on p.id = card->>'printingId'
     where card->>'board' = 'commander'
     order by d.set_code, d.name, p.name
  `);
  const byDeck = new Map<string, PreconCommanders>();
  for (const row of rows.rows) {
    const key = `${row.set_code}/${row.deck_name}`;
    const deck = byDeck.get(key) ?? {
      setCode: row.set_code,
      deckName: row.deck_name,
      commanders: [],
    };
    deck.commanders.push({
      name: row.name,
      typeLine: row.type_line,
      text: row.face_text,
      colorIdentity: row.color_identity.map((color) => ColorSchema.parse(color)),
      legalities: row.legalities ?? {},
      isBasicLand: false,
      hasPowerToughness: row.has_power_toughness,
    });
    byDeck.set(key, deck);
  }
  return [...byDeck.values()];
}
