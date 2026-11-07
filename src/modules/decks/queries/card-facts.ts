import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import {
  parseSearch,
  TAGS,
  THEMES,
  type SignalCard,
  type Tag,
  type Theme,
} from "@/shared/card-search";
import { foilOwnedBy, searchCondition } from "@/shared/card-search/sql";
import { ownedCopies, STANDARD_FIRST } from "./owned";

// Card facts for the LLM tools (design doc 28): finding a card by the name a person (or a model)
// writes, and the cards a deck or a search holds, as analyze_cards reads them (section 3.7).

/** A card found by name or id: its oracle card and standard printing (design doc 24). */
export type CardReference = Readonly<{
  oracleId: string;
  printingId: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  text: string;
  colorIdentity: string[];
}>;

/**
 * Finds a card by its name (any letter case; a double-faced card's front name works too), its
 * oracle id, or one printing's id. A printing id gives that printing; otherwise the card's
 * standard printing. Null when nothing matches.
 */
export async function findCard(db: DbExecutor, nameOrId: string): Promise<CardReference | null> {
  const text = nameOrId.trim();
  if (text === "") return null;
  const [row] = (
    await db.execute<{
      oracle_id: string;
      printing_id: string;
      name: string;
      type_line: string;
      mana_cost: string | null;
      face_text: string;
      color_identity: string[];
    }>(sql`
      select p.oracle_id, p.id as printing_id, p.name, p.type_line, p.mana_cost, p.color_identity,
             coalesce((select string_agg(f->>'text', ${"\n"}) from jsonb_array_elements(p.faces) f), '')
               as face_text
        from printings p join card_sets s on s.code = p.set_code
       where p.id = ${text} or p.oracle_id = ${text}
          or lower(p.name) = lower(${text})
          or lower(split_part(p.name, ' // ', 1)) = lower(${text})
       order by (p.id = ${text}) desc, ${STANDARD_FIRST}
       limit 1
    `)
  ).rows;
  if (row === undefined) return null;
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    name: row.name,
    typeLine: row.type_line,
    manaCost: row.mana_cost,
    text: row.face_text,
    colorIdentity: row.color_identity,
  };
}

/** At most this many cards are read for one analysis. */
export const SIGNAL_CARD_LIMIT = 500;

type SignalRow = {
  name: string;
  type_line: string;
  face_text: string;
  keywords: string[];
  role_tags: string[];
  theme_tags: string[];
};

const SIGNAL_COLUMNS = sql`p.name, p.type_line, p.keywords, p.role_tags, p.theme_tags,
  coalesce((select string_agg(f->>'text', ${"\n"}) from jsonb_array_elements(p.faces) f), '') as face_text`;

function toSignalCard(row: SignalRow): SignalCard {
  return {
    name: row.name,
    typeLine: row.type_line,
    text: row.face_text,
    keywords: row.keywords,
    roleTags: row.role_tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag)),
    themes: row.theme_tags.filter((theme): theme is Theme =>
      (THEMES as readonly string[]).includes(theme),
    ),
  };
}

/** The cards of one of your decks (commander and main deck, one each), or null if it isn't yours. */
export async function deckSignalCards(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<SignalCard[] | null> {
  const [deck] = (
    await db.execute<{ id: number }>(
      sql`select id from decks where id = ${deckId} and owner_id = ${userId}`,
    )
  ).rows;
  if (deck === undefined) return null;
  const rows = await db.execute<SignalRow>(sql`
    select ${SIGNAL_COLUMNS}
      from (select distinct e.oracle_id from deck_entries e
             where e.deck_id = ${deckId} and e.board in ('main', 'commander')) entry
      join lateral (select * from printings p where p.oracle_id = entry.oracle_id limit 1) p on true
     order by p.name
     limit ${SIGNAL_CARD_LIMIT}
  `);
  return rows.rows.map(toSignalCard);
}

/** Your cards (game and real) matching a search, one per card, and the search's notes. */
export async function ownedSignalCards(
  db: DbExecutor,
  userId: UserId,
  search: string,
): Promise<{ cards: SignalCard[]; notes: readonly string[] }> {
  const parsed = parseSearch(search);
  const condition = searchCondition(parsed.node, {
    userId,
    foil: foilOwnedBy(userId, { includeReal: true }),
    ownIncludesReal: true,
  });
  const rows = await db.execute<SignalRow>(sql`
    select ${SIGNAL_COLUMNS}
      from (select distinct on (p.oracle_id) p.*
              from ${ownedCopies(userId, sql`true`)} c join printings p on p.id = c.printing_id
             where ${condition}
             order by p.oracle_id) p
     order by p.name
     limit ${SIGNAL_CARD_LIMIT}
  `);
  return { cards: rows.rows.map(toSignalCard), notes: parsed.notes };
}
