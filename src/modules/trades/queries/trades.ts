import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";

// Read models for the trade screens (design doc 10, section 9).

export type TradingPartner = Readonly<{ userId: string; displayName: string; username: string }>;

/** Every active player except you, by display name. */
export async function tradingPartners(db: DbExecutor, userId: UserId): Promise<TradingPartner[]> {
  const rows = await db.execute<{ user_id: string; name: string; username: string | null }>(sql`
    select p.user_id, u.name, u.username
      from players p join auth_users u on u.id = p.user_id
     where p.disabled_at is null and p.user_id <> ${userId}
     order by lower(u.name)
  `);
  return rows.rows.map((row) => ({
    userId: row.user_id,
    displayName: row.name,
    username: row.username ?? "",
  }));
}

/** How many trades are waiting for you to decide (the header's badge). */
export async function tradesWaitingForYou(db: DbExecutor, userId: UserId): Promise<number> {
  const [row] = (
    await db.execute<{ total: number }>(sql`
      select count(*)::int as total from trades where recipient_id = ${userId} and status = 'proposed'
    `)
  ).rows;
  return row?.total ?? 0;
}

export type TradeItemView = Readonly<{
  from: "proposer" | "recipient";
  kind: "card" | "money";
  printingId: string | null;
  finish: "nonfoil" | "foil" | "etched" | null;
  quantity: number | null;
  amountCents: number | null;
  name: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  /** Latest market price of one copy in that finish, for comparing the two sides. */
  priceCents: number | null;
}>;

export type TradeView = Readonly<{
  id: number;
  status: "proposed" | "accepted" | "declined" | "cancelled" | "countered";
  proposer: TradingPartner;
  recipient: TradingPartner;
  /** Which side you're on, so the page knows which buttons to show. */
  yourSide: "proposer" | "recipient";
  message: string;
  replacesId: number | null;
  createdAt: string;
  decidedAt: string | null;
  items: TradeItemView[];
}>;

type TradeRow = {
  id: number;
  status: TradeView["status"];
  proposer_id: string;
  proposer_name: string;
  proposer_username: string | null;
  recipient_id: string;
  recipient_name: string;
  recipient_username: string | null;
  message: string;
  replaces_id: number | null;
  created_at: Date;
  decided_at: Date | null;
};

const TRADE_COLUMNS = sql`
  t.id, t.status, t.message, t.replaces_id, t.created_at, t.decided_at,
  t.proposer_id, pu.name as proposer_name, pu.username as proposer_username,
  t.recipient_id, ru.name as recipient_name, ru.username as recipient_username`;
const TRADE_JOINS = sql`
  join auth_users pu on pu.id = t.proposer_id
  join auth_users ru on ru.id = t.recipient_id`;

async function itemsOf(
  db: DbExecutor,
  tradeIds: readonly number[],
): Promise<Map<number, TradeItemView[]>> {
  if (tradeIds.length === 0) return new Map();
  const rows = await db.execute<{
    trade_id: number;
    from_side: TradeItemView["from"];
    kind: TradeItemView["kind"];
    printing_id: string | null;
    finish: TradeItemView["finish"];
    quantity: number | null;
    amount_cents: number | null;
    name: string | null;
    set_code: string | null;
    collector_number: string | null;
    price: number | null;
  }>(sql`
    select i.trade_id, i.from_side, i.kind, i.printing_id, i.finish, i.quantity, i.amount_cents,
           p.name, p.set_code, p.collector_number,
           (select s.usd_cents from price_snapshots s
             where s.printing_id = i.printing_id and s.finish = i.finish
             order by s.day desc limit 1) as price
      from trade_items i left join printings p on p.id = i.printing_id
     where i.trade_id = any(${sql.param([...tradeIds])}::bigint[])
     order by i.trade_id, i.position
  `);
  const items = new Map<number, TradeItemView[]>();
  for (const row of rows.rows) {
    const id = Number(row.trade_id);
    items.set(id, [
      ...(items.get(id) ?? []),
      {
        from: row.from_side,
        kind: row.kind,
        printingId: row.printing_id,
        finish: row.finish,
        quantity: row.quantity,
        amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
        name: row.name,
        setCode: row.set_code,
        collectorNumber: row.collector_number,
        priceCents: row.price === null ? null : Number(row.price),
      },
    ]);
  }
  return items;
}

function toView(row: TradeRow, userId: UserId, items: TradeItemView[]): TradeView {
  return {
    id: Number(row.id),
    status: row.status,
    proposer: {
      userId: row.proposer_id,
      displayName: row.proposer_name,
      username: row.proposer_username ?? "",
    },
    recipient: {
      userId: row.recipient_id,
      displayName: row.recipient_name,
      username: row.recipient_username ?? "",
    },
    yourSide: row.proposer_id === userId ? "proposer" : "recipient",
    message: row.message,
    replacesId: row.replaces_id === null ? null : Number(row.replaces_id),
    createdAt: new Date(row.created_at).toISOString(),
    decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
    items,
  };
}

/** One trade you're part of, or null. */
export async function tradeView(
  db: DbExecutor,
  userId: UserId,
  tradeId: number,
): Promise<TradeView | null> {
  const [row] = (
    await db.execute<TradeRow>(sql`
      select ${TRADE_COLUMNS} from trades t ${TRADE_JOINS}
       where t.id = ${tradeId} and (t.proposer_id = ${userId} or t.recipient_id = ${userId})
    `)
  ).rows;
  if (row === undefined) return null;
  const items = await itemsOf(db, [Number(row.id)]);
  return toView(row, userId, items.get(Number(row.id)) ?? []);
}

/** Your trades, newest first (the page splits them into waiting and history). */
export async function tradesFor(db: DbExecutor, userId: UserId, limit = 50): Promise<TradeView[]> {
  const rows = await db.execute<TradeRow>(sql`
    select ${TRADE_COLUMNS} from trades t ${TRADE_JOINS}
     where t.proposer_id = ${userId} or t.recipient_id = ${userId}
     order by (t.status = 'proposed') desc, coalesce(t.decided_at, t.created_at) desc, t.id desc
     limit ${limit}
  `);
  const items = await itemsOf(
    db,
    rows.rows.map((row) => Number(row.id)),
  );
  return rows.rows.map((row) => toView(row, userId, items.get(Number(row.id)) ?? []));
}
