import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import { FORMATS, type Format } from "../domain/deck";
import {
  canViewDeck,
  cardsToGet,
  isValidPublicToken,
  VISIBILITIES,
  type Visibility,
} from "../domain/sharing";
import { deckView, type DeckView } from "./decks";

// Read models for shared decks, comments and cards to get (design doc 21, section 9).

/** A deck as someone may see it: its owner, or anyone when it's shared. */
export type ViewedDeck = Readonly<{
  /** The deck as its owner sees it: the owner's copies and problems (decision 2). */
  view: DeckView;
  ownerName: string;
  isOwner: boolean;
  visibility: Visibility;
  /** The deck's public link token, if enabled; only populated for the owner. */
  publicToken: string | null;
  /** The viewer's own copies of each card in the deck (by oracle id); empty for the owner. */
  yourCopies: Readonly<Record<string, number>>;
}>;

/** The deck if this player may see it (invariant 1), else null. */
export async function deckForViewer(
  db: DbExecutor,
  viewerId: UserId,
  deckId: number,
): Promise<ViewedDeck | null> {
  const [row] = (
    await db.execute<{
      owner_id: string;
      owner_name: string;
      visibility: string;
      public_token: string | null;
    }>(sql`
      select d.owner_id, u.name as owner_name, d.visibility, d.public_token
        from decks d join auth_users u on u.id = d.owner_id
       where d.id = ${deckId}
    `)
  ).rows;
  if (row === undefined) return null;
  const visibility = z.enum(VISIBILITIES).parse(row.visibility);
  const ownerId = UserId.of(row.owner_id);
  if (!canViewDeck(viewerId, { ownerId, visibility })) return null;
  const view = await deckView(db, ownerId, deckId);
  if (view === null) return null;
  const isOwner = ownerId === viewerId;
  let yourCopies: Record<string, number> = {};
  if (!isOwner && view.lines.length > 0) {
    const copies = await db.execute<{ oracle_id: string; owned: number }>(sql`
      select p.oracle_id, sum(c.quantity)::int as owned
        from collection_cards c join printings p on p.id = c.printing_id
       where c.user_id = ${viewerId}
         and p.oracle_id in (select oracle_id from deck_entries where deck_id = ${deckId})
       group by p.oracle_id
    `);
    yourCopies = Object.fromEntries(copies.rows.map((copy) => [copy.oracle_id, copy.owned]));
  }
  return {
    view,
    ownerName: row.owner_name,
    isOwner,
    visibility,
    publicToken: isOwner ? row.public_token : null,
    yourCopies,
  };
}

export type PublicDeck = Readonly<{
  view: DeckView;
  ownerName: string;
}>;

/** A deck opened via its unguessable `/d/[token]` public link (design doc 47), or null. */
export async function publicDeckByToken(db: DbExecutor, token: string): Promise<PublicDeck | null> {
  if (!isValidPublicToken(token)) return null;
  const [row] = (
    await db.execute<{ id: number; owner_id: string; owner_name: string }>(sql`
      select d.id, d.owner_id, u.name as owner_name
        from decks d join auth_users u on u.id = d.owner_id
       where d.public_token = ${token}
    `)
  ).rows;
  if (row === undefined) return null;
  const view = await deckView(db, UserId.of(row.owner_id), Number(row.id));
  if (view === null) return null;
  return { view, ownerName: row.owner_name };
}

export type CommentView = Readonly<{
  id: number;
  authorId: string;
  authorName: string;
  /** Null once deleted: the comment keeps its place without its text. */
  body: string | null;
  at: string;
}>;

/** A deck's comments, oldest first. The caller has already checked the viewer may see the deck. */
export async function deckComments(db: DbExecutor, deckId: number): Promise<CommentView[]> {
  const rows = await db.execute<{
    id: number;
    author_id: string;
    author_name: string;
    body: string;
    created_at: Date;
    deleted_at: Date | null;
  }>(sql`
    select c.id, c.author_id, u.name as author_name, c.body, c.created_at, c.deleted_at
      from deck_comments c join auth_users u on u.id = c.author_id
     where c.deck_id = ${deckId}
     order by c.created_at, c.id
  `);
  return rows.rows.map((row) => ({
    id: Number(row.id),
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.deleted_at === null ? row.body : null,
    at: new Date(row.created_at).toISOString(),
  }));
}

export type SharedDeck = Readonly<{
  id: number;
  name: string;
  format: Format;
  ownerName: string;
  cards: number;
  commanders: string[];
  comments: number;
  updatedAt: string;
}>;

/** Every shared deck on the server, most recently changed first. */
export async function sharedDecks(db: DbExecutor): Promise<SharedDeck[]> {
  const rows = await db.execute<{
    id: number;
    name: string;
    format: string;
    owner_name: string;
    cards: number;
    commanders: string[] | null;
    comments: number;
    updated_at: Date;
  }>(sql`
    select d.id, d.name, d.format, u.name as owner_name, d.updated_at,
           coalesce((select sum(e.quantity) from deck_entries e
                      where e.deck_id = d.id and e.board <> 'maybe'), 0)::int as cards,
           (select array_agg(distinct p.name) from deck_entries e
              join printings p on p.oracle_id = e.oracle_id
             where e.deck_id = d.id and e.board = 'commander') as commanders,
           (select count(*) from deck_comments c
             where c.deck_id = d.id and c.deleted_at is null)::int as comments
      from decks d join auth_users u on u.id = d.owner_id
     where d.visibility = 'shared'
     order by d.updated_at desc, d.id desc
     limit 200
  `);
  return rows.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    format: z.enum(FORMATS).parse(row.format),
    ownerName: row.owner_name,
    cards: row.cards,
    commanders: row.commanders ?? [],
    comments: row.comments,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export type CardToGetView = Readonly<{
  oracleId: string;
  name: string;
  missing: number;
  /** The most any one deck uses: the line to buy, since Buy a list skips copies you own. */
  needed: number;
  owned: number;
  decks: ReadonlyArray<Readonly<{ id: number; name: string }>>;
  /** The cheapest copy for sale in an enabled set, or null when the store has none. */
  priceCents: number | null;
}>;

export type CardsToGet = Readonly<{
  cards: CardToGetView[];
  /** What the missing copies cost at the cheapest prices (cards without a price count 0). */
  totalCents: number;
  /** For Buy a list: each card at the count the hungriest deck uses (design doc 21). */
  listText: string;
}>;

/** Every card your decks need beyond what you own (invariant 6), with store prices. */
export async function cardsToGetFor(db: DbExecutor, userId: UserId): Promise<CardsToGet> {
  const needs = await db.execute<{
    deck_id: number;
    deck_name: string;
    oracle_id: string;
    quantity: number;
    real_copies: number;
  }>(sql`
    select e.deck_id, d.name as deck_name, e.oracle_id, sum(e.quantity)::int as quantity,
           -- Real copies this deck counts (design doc 16, rule 2): none unless its switch is on.
           case when d.uses_real_cards then
             coalesce((select sum(r.quantity) from real_cards r join printings rp on rp.id = r.printing_id
                        where r.user_id = ${userId} and rp.oracle_id = e.oracle_id), 0)
           else 0 end::int as real_copies
      from deck_entries e join decks d on d.id = e.deck_id
     where d.owner_id = ${userId} and e.board <> 'maybe'
       -- Basic lands are never short (design doc 09, rule 1).
       and not exists (select 1 from printings p
                        where p.oracle_id = e.oracle_id and p.type_line ~ '^Basic\\y.*\\yLand\\y')
     group by e.deck_id, d.name, d.uses_real_cards, e.oracle_id
  `);
  if (needs.rows.length === 0) return { cards: [], totalCents: 0, listText: "" };
  const oracleIds = [...new Set(needs.rows.map((row) => row.oracle_id))];
  const oracleArray = sql`array[${sql.join(
    oracleIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  const [ownedRows, cardRows] = await Promise.all([
    db.execute<{ oracle_id: string; owned: number }>(sql`
      select p.oracle_id, sum(c.quantity)::int as owned
        from collection_cards c join printings p on p.id = c.printing_id
       where c.user_id = ${userId} and p.oracle_id = any(${oracleArray})
       group by p.oracle_id
    `),
    db.execute<{ oracle_id: string; name: string; price_cents: number | null }>(sql`
      select ids.oracle_id,
             (select p.name from printings p where p.oracle_id = ids.oracle_id limit 1) as name,
             (select min(latest.usd_cents)
                from printings p join card_sets s on s.code = p.set_code and s.is_enabled
                join lateral (select distinct on (ps.finish) ps.usd_cents
                                from price_snapshots ps where ps.printing_id = p.id
                               order by ps.finish, ps.day desc) latest on true
               where p.oracle_id = ids.oracle_id) as price_cents
        from unnest(${oracleArray}) as ids(oracle_id)
    `),
  ]);
  const owned = new Map(ownedRows.rows.map((row) => [row.oracle_id, row.owned]));
  const cardInfo = new Map(cardRows.rows.map((row) => [row.oracle_id, row]));
  const deckNames = new Map(needs.rows.map((row) => [Number(row.deck_id), row.deck_name]));
  // A deck that uses real cards needs only what its real copies don't cover; the rest is bought
  // as game copies, which every deck shares.
  const missing = cardsToGet(
    needs.rows.map((row) => ({
      deckId: Number(row.deck_id),
      oracleId: row.oracle_id,
      quantity: Math.max(0, row.quantity - row.real_copies),
    })),
    owned,
  );

  const cards = missing
    .map((card) => {
      const info = cardInfo.get(card.oracleId);
      const have = owned.get(card.oracleId) ?? 0;
      return {
        oracleId: card.oracleId,
        name: info?.name ?? "Unknown card",
        missing: card.missing,
        needed: card.missing + have,
        owned: have,
        decks: card.deckIds.map((id) => ({ id, name: deckNames.get(id) ?? "" })),
        priceCents: info?.price_cents == null ? null : Number(info.price_cents),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    cards,
    totalCents: cards.reduce((sum, card) => sum + card.missing * (card.priceCents ?? 0), 0),
    listText: cards.map((card) => `${card.needed} ${card.name}`).join("\n"),
  };
}
