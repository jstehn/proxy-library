import type { OwnedCardCheck } from "../domain/owned-card-check";
import { sql } from "drizzle-orm";
import { type DbExecutor, newestDayPrice } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { CardFacts, CardIdentity } from "@/shared/mtg";
import { catalogQueries } from "@/modules/catalog";
import { parseSearch } from "@/shared/card-search";
import { foilOwnedBy, searchCondition } from "@/modules/catalog/cards/queries/search-sql";
import type { SignalCard } from "../domain/signals";
import { ownedCopies, STANDARD_FIRST } from "@/modules/decks/core";

// Card facts for the LLM tools (design doc 28): finding a card by the name a person (or a model)
// writes, and the cards a deck or a search holds, as analyze_cards reads them (section 3.7).

/** A card found by name or id: its oracle card and standard printing (design doc 24). */
export type CardReference = CardIdentity &
  Pick<CardFacts, "name" | "typeLine" | "manaCost" | "text"> &
  Readonly<{
    scryfallId: string;
    colorIdentity: string[];
  }>;

type CardReferenceRow = {
  oracle_id: string;
  printing_id: string;
  scryfall_id: string;
  name: string;
  type_line: string;
  mana_cost: string | null;
  face_text: string;
  color_identity: string[];
};

function toCardReference(row: CardReferenceRow): CardReference {
  return {
    oracleId: row.oracle_id,
    printingId: row.printing_id,
    scryfallId: row.scryfall_id,
    name: row.name,
    typeLine: row.type_line,
    manaCost: row.mana_cost,
    text: row.face_text,
    colorIdentity: row.color_identity,
  };
}

/**
 * Finds a card by its name (any letter case; a double-faced card's front name works too), its
 * oracle id, or one printing's id. A printing id gives that printing; otherwise the card's
 * standard printing. Null when nothing matches.
 */
export async function findCard(db: DbExecutor, nameOrId: string): Promise<CardReference | null> {
  const found = await findCards(db, [nameOrId]);
  return found.get(nameOrId) ?? null;
}

/**
 * Batched version of `findCard` for many names/ids at once (used by `edit_deck` previews/saves).
 * Preserves the same specificity priority: printing id > oracle id > exact name > front face > back face.
 */
export async function findCards(
  db: DbExecutor,
  namesOrIds: readonly string[],
): Promise<Map<string, CardReference>> {
  const cleaned = [...new Set(namesOrIds.map((value) => value.trim()).filter(Boolean))];
  if (cleaned.length === 0) return new Map();
  const lowered = cleaned.map((value) => value.toLowerCase());
  const rows = await db.execute<CardReferenceRow & { query_key: string }>(sql`
    with wanted as (
      select raw_key, lower_key
        from unnest(${sql.param(cleaned)}::text[], ${sql.param(lowered)}::text[])
          as input(raw_key, lower_key)
    ),
    matches as (
      select w.raw_key as query_key, 0 as priority, p.*
        from wanted w join printings p on p.id = w.raw_key
      union all
      select w.raw_key as query_key, 1 as priority, p.*
        from wanted w join printings p on p.oracle_id = w.raw_key
      union all
      select w.raw_key as query_key, 2 as priority, p.*
        from wanted w join printings p on lower(p.name) = w.lower_key
      union all
      select w.raw_key as query_key, 3 as priority, p.*
        from wanted w join printings p
          on p.name like '% // %' and lower(split_part(p.name, ' // ', 1)) = w.lower_key
      union all
      select w.raw_key as query_key, 4 as priority, p.*
        from wanted w join printings p
          on p.name like '% // %' and lower(split_part(p.name, ' // ', 2)) = w.lower_key
    )
    select distinct on (p.query_key)
           p.query_key,
           p.oracle_id, p.id as printing_id, p.scryfall_id, p.name, p.type_line, p.mana_cost,
           p.color_identity,
           coalesce((select string_agg(f->>'text', ${"\n"}) from jsonb_array_elements(p.faces) f), '')
             as face_text
      from matches p
      join card_sets s on s.code = p.set_code
     order by p.query_key, p.priority, ${STANDARD_FIRST}
  `);
  const byTrimmed = new Map<string, CardReference>();
  for (const row of rows.rows) {
    byTrimmed.set(row.query_key, toCardReference(row));
  }
  const results = new Map<string, CardReference>();
  for (const original of namesOrIds) {
    const matched = byTrimmed.get(original.trim());
    if (matched !== undefined) results.set(original, matched);
  }
  return results;
}

/** At most this many cards are read for one analysis. */
const SIGNAL_CARD_LIMIT = 500;

type SignalRow = { oracle_id: string; name: string };

const SIGNAL_COLUMNS = sql`p.oracle_id, p.name`;

/** The cards with what their features say each shows (the catalog's card features). */
async function toSignalCards(db: DbExecutor, rows: readonly SignalRow[]): Promise<SignalCard[]> {
  const features = await catalogQueries.cardFeatures(
    db,
    rows.map((row) => row.oracle_id),
  );
  return rows.flatMap((row) => {
    const card = features.get(row.oracle_id);
    return card === undefined ? [] : [{ name: row.name, ...card }];
  });
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
  return toSignalCards(db, rows.rows);
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
  return { cards: await toSignalCards(db, rows.rows), notes: parsed.notes };
}

export type { OwnedCardCheck };

/** Batch-checks ownership (game + real), cheapest store price, and deck usage for up to 100 names. */
export async function checkOwnedCards(
  db: DbExecutor,
  userId: UserId,
  names: readonly string[],
): Promise<OwnedCardCheck[]> {
  const cleaned = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (cleaned.length === 0) return [];
  const lowerUnique = [...new Set(cleaned.map((n) => n.toLowerCase()))];
  const lowerArray = sql`array[${sql.join(
    lowerUnique.map((n) => sql`${n}`),
    sql`, `,
  )}]::text[]`;

  const resolvedRows = await db.execute<{
    oracle_id: string;
    name: string;
    front_name: string;
  }>(sql`
    with matched as (
      select p.* from printings p
       where lower(p.name) = any(${lowerArray})
      union all
      select p.* from printings p
       where p.name like '% // %'
         and lower(split_part(p.name, ' // ', 1)) = any(${lowerArray})
    )
    select distinct on (p.oracle_id) p.oracle_id, p.name,
           lower(split_part(p.name, ' // ', 1)) as front_name
      from matched p join card_sets s on s.code = p.set_code
     order by p.oracle_id, ${STANDARD_FIRST}
  `);

  const byLowerName = new Map<string, { oracleId: string; name: string }>();
  for (const row of resolvedRows.rows) {
    byLowerName.set(row.name.toLowerCase(), { oracleId: row.oracle_id, name: row.name });
    if (!byLowerName.has(row.front_name)) {
      byLowerName.set(row.front_name, { oracleId: row.oracle_id, name: row.name });
    }
  }

  const oracleIds = [...new Set([...byLowerName.values()].map((v) => v.oracleId))];
  if (oracleIds.length === 0) {
    return names.map((query) => ({
      query,
      inCatalog: false,
      status: "not in catalog",
    }));
  }

  const oracleArray = sql`array[${sql.join(
    oracleIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;

  const [ownedRows, priceRows, deckRows] = await Promise.all([
    db.execute<{ oracle_id: string; game: number; real: number }>(sql`
      select p.oracle_id,
             coalesce(sum(case when not c.is_real then c.quantity else 0 end), 0)::int as game,
             coalesce(sum(case when c.is_real then c.quantity else 0 end), 0)::int as real
        from ${ownedCopies(userId, sql`true`)} c
        join printings p on p.id = c.printing_id
       where p.oracle_id = any(${oracleArray})
       group by p.oracle_id
    `),
    db.execute<{ oracle_id: string; cheapest_cents: number }>(sql`
      select distinct on (p.oracle_id) p.oracle_id, latest.usd_cents as cheapest_cents
        from printings p
        join card_sets s on s.code = p.set_code and s.is_enabled
        join lateral (select ${newestDayPrice("p.id")} as usd_cents) latest on true
       where p.oracle_id = any(${oracleArray})
       order by p.oracle_id, latest.usd_cents asc
    `),
    db.execute<{ oracle_id: string; deck_id: number; name: string; quantity: number }>(sql`
      select e.oracle_id, d.id as deck_id, d.name, sum(e.quantity)::int as quantity
        from deck_entries e
        join decks d on d.id = e.deck_id and d.owner_id = ${userId}
       where e.oracle_id = any(${oracleArray}) and e.board <> 'maybe'
       group by e.oracle_id, d.id, d.name
       order by d.name
    `),
  ]);

  const ownedMap = new Map<string, { game: number; real: number }>();
  for (const row of ownedRows.rows) {
    ownedMap.set(row.oracle_id, { game: row.game, real: row.real });
  }

  const priceMap = new Map<string, number>();
  for (const row of priceRows.rows) {
    priceMap.set(row.oracle_id, row.cheapest_cents);
  }

  const deckMap = new Map<string, { id: number; name: string; quantity: number }[]>();
  for (const row of deckRows.rows) {
    const list = deckMap.get(row.oracle_id) ?? [];
    list.push({ id: Number(row.deck_id), name: row.name, quantity: row.quantity });
    deckMap.set(row.oracle_id, list);
  }

  return names.map((query) => {
    const match = byLowerName.get(query.trim().toLowerCase());
    if (!match) {
      return { query, inCatalog: false, status: "not in catalog" };
    }
    const owned = ownedMap.get(match.oracleId) ?? { game: 0, real: 0 };
    return {
      query,
      inCatalog: true,
      name: match.name,
      oracleId: match.oracleId,
      ownedGame: owned.game,
      ownedReal: owned.real,
      ownedTotal: owned.game + owned.real,
      cheapestPriceCents: priceMap.get(match.oracleId) ?? null,
      decks: deckMap.get(match.oracleId) ?? [],
    };
  });
}
