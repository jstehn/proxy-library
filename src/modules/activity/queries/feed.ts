import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";

// The activity feed (design doc 11, section 2): newest first, with players' display names.

export type FeedItem =
  | Readonly<{
      id: number;
      kind: "pull";
      at: string;
      actor: string;
      itemName: string;
      cards: FeedCard[];
    }>
  | Readonly<{
      id: number;
      kind: "purchase";
      at: string;
      actor: string;
      productName: string;
      quantity: number;
    }>
  | Readonly<{
      id: number;
      kind: "trade";
      at: string;
      actor: string;
      other: string;
      cardsMoved: number;
      moneyChanged: boolean;
    }>
  | Readonly<{
      id: number;
      kind: "draft";
      at: string;
      actor: string;
      setName: string;
      players: number;
    }>
  | Readonly<{
      id: number;
      kind: "deckShared";
      at: string;
      actor: string;
      deckId: number;
      deckName: string;
      format: string;
    }>
  | Readonly<{
      id: number;
      kind: "deckComment";
      at: string;
      actor: string;
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
  other: string | null;
  payload: Record<string, unknown>;
};

/**
 * The newest events, newest first. A deck's events ("shared a deck", "commented on") show only
 * while the deck exists and is shared: a deleted deck, a reset player's deck, or one made private
 * again drops out, so the feed never links to a deck you can't open or names a private one
 * (design doc 21, rule 9). Checked when reading, so the events themselves are never changed.
 */
export async function activityFeed(db: DbExecutor, limit = 50): Promise<FeedItem[]> {
  const rows = await db.execute<Row>(sql`
    select e.id, e.kind, e.occurred_at, a.name as actor, o.name as other, e.payload
      from activity_events e
      join auth_users a on a.id = e.actor_id
      left join auth_users o on o.id = e.payload->>'otherId'
     where e.kind not in ('deckShared', 'deckComment')
        or exists (select 1 from decks d
                    where d.id = (e.payload->>'deckId')::bigint and d.visibility = 'shared')
     order by e.occurred_at desc, e.id desc
     limit ${limit}
  `);
  return rows.rows.flatMap((row): FeedItem[] => {
    const base = {
      id: Number(row.id),
      at: new Date(row.occurred_at).toISOString(),
      actor: row.actor,
    };
    const payload = row.payload;
    // Written by this module's recorder, so these shapes are known.
    switch (row.kind) {
      case "pull":
        return [
          {
            ...base,
            kind: "pull",
            itemName: String(payload.itemName),
            cards: payload.cards as FeedCard[],
          },
        ];
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
