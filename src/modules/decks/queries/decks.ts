import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import {
  BOARDS,
  DeckId,
  DeckOrigin,
  FORMATS,
  type Board,
  type Deck,
  type Format,
} from "../domain/deck";
import { isBracket } from "../domain/brackets";
import type { CardRules } from "../domain/rules";
import { MOST_SPECIAL_FIRST, ownedCopies, STANDARD_FIRST } from "./owned";
import { VISIBILITIES, type Visibility } from "../domain/sharing";

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
       where d.owner_id = ${userId}
       group by e.deck_id, e.oracle_id
    )
    select d.id, d.name, d.format, d.updated_at, d.origin, d.visibility, d.uses_real_cards,
           coalesce((select sum(e.quantity) from deck_entries e where e.deck_id = d.id), 0)::int as cards,
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

/** One deck line with everything the builder shows. */
export type DeckLine = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  /**
   * The printing to show and export: the pinned one, else your most special copy, else the
   * card's standard printing (design doc 24).
   */
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  /** What the deck stores (null when not pinned): for Edit as text (design doc 23). */
  pinnedPrintingId: string | null;
  pinnedFinish: "nonfoil" | "foil" | "etched" | null;
  name: string;
  typeLine: string;
  manaValue: number;
  /** e.g. "{2}{W}{U}", or null for cards without one (lands). */
  manaCost: string | null;
  /** Colors of mana it can make, for the deck statistics. */
  producedMana: string[];
  /** Rules text of every face, for role tags (design doc 19). */
  text: string;
  /** On Wizards' Game Changer list (design doc 31). */
  isGameChanger: boolean;
  /** Latest market price of one copy in its finish, in cents, if known. */
  priceCents: number | null;
  setCode: string;
  collectorNumber: string;
  /** Copies counted as owned: game copies, plus real ones when the deck uses them. */
  owned: number;
  /** How many of `owned` are real copies (design doc 16: "3 game · 1 real"). */
  ownedReal: number;
  isBasicLand: boolean;
  /**
   * Your other decks that also use this card, and how many copies each holds (ownership is
   * shared between decks, so they can all count the same copies).
   */
  otherDecks: OtherDeckUse[];
  /** Copies owned that none of your other decks uses (task 42): `owned` minus theirs, at least 0. */
  free: number;
}>;

/** Another of your decks holding a card, on any board (task 42). */
export type OtherDeckUse = Readonly<{
  deckId: number;
  name: string;
  /** Copies of the card in that deck, on every board. */
  quantity: number;
  /** How many of them it can give: all but its commanders, which are never taken. */
  available: number;
}>;

const OtherDeckUsesSchema = z.array(
  z.object({
    deckId: z.coerce.number(),
    name: z.string(),
    quantity: z.coerce.number(),
    available: z.coerce.number(),
  }),
);

/**
 * SQL: a JSON list of `OtherDeckUse`, or null: the player's decks other than `deckId` that hold
 * card `oracleId` (both are SQL, so a query can pass its own columns).
 */
function otherDeckUses(userId: UserId, deckId: SQL, oracleId: SQL): SQL {
  return sql`(select json_agg(json_build_object('deckId', other.id, 'name', other.name,
                                                'quantity', used.quantity, 'available', used.available)
                              order by other.name, other.id)
                from (select e2.deck_id, sum(e2.quantity)::int as quantity,
                             coalesce(sum(e2.quantity) filter (where e2.board <> 'commander'), 0)::int as available
                        from deck_entries e2
                       where e2.oracle_id = ${oracleId} and e2.deck_id <> ${deckId}
                       group by e2.deck_id) used
                join decks other on other.id = used.deck_id
               where other.owner_id = ${userId})`;
}

/** Your decks other than `deckId` that hold a card, and how many copies each (task 42). */
export async function otherDecksHolding(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  oracleId: string,
): Promise<OtherDeckUse[]> {
  const rows = await db.execute<{ uses: unknown }>(
    sql`select ${otherDeckUses(userId, sql`${deckId}`, sql`${oracleId}`)} as uses`,
  );
  return OtherDeckUsesSchema.parse(rows.rows[0]?.uses ?? []);
}

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
    await db.execute<{
      id: number;
      owner_id: string;
      name: string;
      format: string;
      uses_real_cards: boolean;
      target_bracket: number | null;
    }>(sql`
      select id, owner_id, name, format, uses_real_cards, target_bracket from decks
       where id = ${deckId} and owner_id = ${userId}
    `)
  ).rows;
  if (deckRow === undefined) return null;
  const owned = ownedCopies(userId, sql`${deckRow.uses_real_cards}`);

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
    mana_cost: string | null;
    produced_mana: string[] | null;
    price_cents: number | null;
    set_code: string;
    collector_number: string;
    is_basic_land: boolean;
    face_text: string;
    is_game_changer: boolean;
    has_power_toughness: boolean;
    color_identity: string[];
    legalities: Record<string, string> | null;
    owned: number;
    owned_real: number;
    other_decks: unknown;
  }>(sql`
    select e.oracle_id, e.board, e.quantity, e.printing_id as pinned_printing, e.finish as pinned_finish,
           shown.id as printing_id,
           coalesce(e.finish, owned_finish.finish,
                    case when 'nonfoil' = any(shown.finishes) then 'nonfoil' else shown.finishes[1] end) as finish,
           shown.name, shown.type_line, shown.mana_value, shown.mana_cost, shown.produced_mana,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = shown.id
               and s.finish = coalesce(e.finish, owned_finish.finish,
                    case when 'nonfoil' = any(shown.finishes) then 'nonfoil' else shown.finishes[1] end)
             order by s.day desc limit 1) as price_cents,
           shown.set_code, shown.collector_number,
           newest.is_basic_land, newest.face_text, newest.has_power_toughness,
           exists (select 1 from printings g
                    where g.oracle_id = e.oracle_id and g.is_game_changer) as is_game_changer,
           newest.color_identity, newest.legalities,
           coalesce((select sum(c.quantity) from ${owned} c join printings p on p.id = c.printing_id
                      where p.oracle_id = e.oracle_id), 0)::int as owned,
           coalesce((select sum(c.quantity) from ${owned} c join printings p on p.id = c.printing_id
                      where c.is_real and p.oracle_id = e.oracle_id), 0)::int as owned_real,
           ${otherDeckUses(userId, sql`e.deck_id`, sql`e.oracle_id`)} as other_decks
      from deck_entries e
      -- The newest printing carries the current rules facts (legalities, identity).
      join lateral (
        select p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
               coalesce((select string_agg(f->>'text', ' ') from jsonb_array_elements(p.faces) f), '') as face_text,
               exists (select 1 from jsonb_array_elements(p.faces) f
                        where f->>'power' is not null and f->>'toughness' is not null) as has_power_toughness,
               p.color_identity, p.legalities
          from printings p join card_sets s on s.code = p.set_code
         where p.oracle_id = e.oracle_id
         order by p.legalities is not null desc, s.release_date desc limit 1
      ) newest on true
      -- Unpinned: show your most special copy of the card (design doc 23, section 14).
      left join lateral (
        select c.printing_id, c.finish from ${owned} c join printings p on p.id = c.printing_id
         where p.oracle_id = e.oracle_id
         order by ${MOST_SPECIAL_FIRST} limit 1
      ) owned_printing on true
      -- Else the card's standard printing (design doc 24, rule 2).
      join lateral (
        select p.* from printings p join card_sets s on s.code = p.set_code
         where p.id = coalesce(e.printing_id, owned_printing.printing_id)
            or (e.printing_id is null and owned_printing.printing_id is null and p.oracle_id = e.oracle_id)
         order by ${STANDARD_FIRST} limit 1
      ) shown on true
      -- The finish of the copy shown: your most special copy of that printing, so a pinned
      -- printing never borrows the finish of another one.
      left join lateral (
        select c.finish from ${owned} c join printings p on p.id = c.printing_id
         where c.printing_id = shown.id
         order by ${MOST_SPECIAL_FIRST} limit 1
      ) owned_finish on true
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
      hasPowerToughness: row.has_power_toughness,
    };
    const otherDecks = OtherDeckUsesSchema.parse(row.other_decks ?? []);
    const usedElsewhere = otherDecks.reduce((total, use) => total + use.quantity, 0);
    return {
      oracleId: row.oracle_id,
      board: z.enum(BOARDS).parse(row.board),
      quantity: row.quantity,
      printingId: row.printing_id,
      finish: FinishSchema.parse(row.finish),
      pinnedPrintingId: row.pinned_printing,
      pinnedFinish: row.pinned_finish === null ? null : FinishSchema.parse(row.pinned_finish),
      name: row.name,
      typeLine: row.type_line,
      manaValue: Number(row.mana_value),
      manaCost: row.mana_cost,
      producedMana: row.produced_mana ?? [],
      text: row.face_text,
      isGameChanger: row.is_game_changer,
      priceCents: row.price_cents === null ? null : Number(row.price_cents),
      setCode: row.set_code,
      collectorNumber: row.collector_number,
      owned: row.owned,
      ownedReal: row.owned_real,
      isBasicLand: row.is_basic_land,
      otherDecks,
      free: Math.max(row.owned - usedElsewhere, 0),
    };
  });

  const deck: Deck = {
    id: DeckId.of(Number(deckRow.id)),
    ownerId: UserId.of(deckRow.owner_id),
    name: deckRow.name,
    format: z.enum(FORMATS).parse(deckRow.format),
    usesRealCards: deckRow.uses_real_cards,
    targetBracket:
      deckRow.target_bracket !== null && isBracket(deckRow.target_bracket)
        ? deckRow.target_bracket
        : null,
    entries: rows.rows.map((row) => ({
      oracleId: row.oracle_id,
      board: z.enum(BOARDS).parse(row.board),
      quantity: row.quantity,
      // Brands are made at the edges, not in read models: the stored printing and finish are on
      // each line as `pinnedPrintingId` and `pinnedFinish`.
      printingId: null,
      finish: null,
    })),
  };
  return { deck, lines, rules };
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
