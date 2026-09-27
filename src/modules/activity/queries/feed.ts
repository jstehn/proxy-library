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

export async function activityFeed(db: DbExecutor, limit = 50): Promise<FeedItem[]> {
  const rows = await db.execute<Row>(sql`
    select e.id, e.kind, e.occurred_at, a.name as actor, o.name as other, e.payload
      from activity_events e
      join auth_users a on a.id = e.actor_id
      left join auth_users o on o.id = e.payload->>'otherId'
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
      default:
        return [];
    }
  });
}
