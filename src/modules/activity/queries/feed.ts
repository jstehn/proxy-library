import { sql } from "drizzle-orm";
import type { Actor } from "@/modules/accounts";
import type { DbExecutor } from "@/shared/db";

// The activity feed (design doc 11, section 2): newest first, with players' display names.

export type FeedItem =
  | Readonly<{
      id: number;
      kind: "pull";
      at: string;
      actor: string;
      actorUsername?: string;
      isOwn: boolean;
      itemId?: number;
      itemName: string;
      cards: FeedCard[];
    }>
  | Readonly<{
      id: number;
      kind: "purchase";
      at: string;
      actor: string;
      actorUsername?: string;
      productName: string;
      quantity: number;
    }>
  | Readonly<{
      id: number;
      kind: "trade";
      at: string;
      actor: string;
      actorUsername?: string;
      other: string;
      cardsMoved: number;
      moneyChanged: boolean;
    }>
  | Readonly<{
      id: number;
      kind: "draft";
      at: string;
      actor: string;
      actorUsername?: string;
      setName: string;
      players: number;
    }>
  | Readonly<{
      id: number;
      kind: "deckShared";
      at: string;
      actor: string;
      actorUsername?: string;
      deckId: number;
      deckName: string;
      format: string;
    }>
  | Readonly<{
      id: number;
      kind: "deckComment";
      at: string;
      actor: string;
      actorUsername?: string;
      /** The deck's owner. */
      other: string;
      deckId: number;
      deckName: string;
    }>;

export type FeedCard = Readonly<{
  printingId: string;
  name: string;
  finish: string;
  rarity: string;
  priceCents: number | null;
}>;

type Row = {
  id: number;
  kind: string;
  occurred_at: Date;
  actor: string;
  actor_username: string;
  is_own: boolean;
  other: string | null;
  payload: Record<string, unknown>;
};

export type ActivityScope = "all" | "friends";

/**
 * The newest events, newest first. A deck's events ("shared a deck", "commented on") show only
 * while the deck exists and is shared: a deleted deck, a reset player's deck, or one made private
 * again drops out, so the feed never links to a deck you can't open or names a private one
 * (design doc 21, rule 9). Checked when reading, so the events themselves are never changed.
 * The "friends" scope is the viewer's friends and the viewer: the read takes the `Actor`, never an
 * id from the caller (design doc 67, kind S).
 */
export async function feed(
  db: DbExecutor,
  actor: Actor,
  options: Readonly<{ limit?: number; scope?: ActivityScope }> = {},
): Promise<FeedItem[]> {
  const { limit = 50, scope = "all" } = options;
  const viewerId = actor.userId;
  const scopeFilter =
    scope === "friends"
      ? sql`and (
          e.actor_id = ${viewerId}
          or exists (
            select 1 from friendships f
             where f.status = 'accepted'
               and ((f.requester_id = ${viewerId} and f.addressee_id = e.actor_id)
                 or (f.addressee_id = ${viewerId} and f.requester_id = e.actor_id))
          )
        )`
      : sql``;

  const rows = await db.execute<Row>(sql`
    select e.id, e.kind, e.occurred_at, a.name as actor,
           coalesce(a.username, a.id) as actor_username,
           e.actor_id = ${viewerId} as is_own,
           o.name as other, e.payload
      from activity_events e
      join auth_users a on a.id = e.actor_id
      left join auth_users o on o.id = e.payload->>'otherId'
     where (e.kind not in ('deckShared', 'deckComment')
        or exists (select 1 from decks d
                    where d.id = (e.payload->>'deckId')::bigint and d.visibility = 'shared'))
       ${scopeFilter}
     order by e.occurred_at desc, e.id desc
     limit ${limit}
  `);
  return rows.rows.flatMap((row): FeedItem[] => {
    const base = {
      id: Number(row.id),
      at: new Date(row.occurred_at).toISOString(),
      actor: row.actor,
      actorUsername: row.actor_username,
    };
    const payload = row.payload;
    // Written by this module's recorder, so these shapes are known.
    switch (row.kind) {
      case "pull": {
        const rawItemId = Number(payload.itemId);
        return [
          {
            ...base,
            kind: "pull",
            isOwn: row.is_own,
            ...(Number.isSafeInteger(rawItemId) && rawItemId > 0 ? { itemId: rawItemId } : {}),
            itemName: String(payload.itemName),
            cards: payload.cards as FeedCard[],
          },
        ];
      }
      case "purchase":
        return [
          {
            ...base,
            kind: "purchase",
            productName: String(payload.productName),
            quantity: Number(payload.quantity),
          },
        ];
      case "trade":
        return [
          {
            ...base,
            kind: "trade",
            other: row.other ?? "someone",
            cardsMoved: Number(payload.cardsMoved),
            moneyChanged: payload.moneyChanged === true,
          },
        ];
      case "draft":
        return [
          {
            ...base,
            kind: "draft",
            setName: String(payload.setName),
            players: Number(payload.players),
          },
        ];
      case "deckShared":
        return [
          {
            ...base,
            kind: "deckShared",
            deckId: Number(payload.deckId),
            deckName: String(payload.deckName),
            format: String(payload.format),
          },
        ];
      case "deckComment":
        return [
          {
            ...base,
            kind: "deckComment",
            other: row.other ?? "someone",
            deckId: Number(payload.deckId),
            deckName: String(payload.deckName),
          },
        ];
      default:
        return [];
    }
  });
}
