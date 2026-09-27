import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, type Finish } from "@/modules/catalog";
import { collectionCards } from "@/modules/collection/infrastructure/schema";
import { players } from "@/modules/accounts/infrastructure/schema";
import type { DbExecutor } from "@/shared/db";
import { assertNever, Cents, UserId } from "@/shared/kernel";
import type { Holdings, NewTrade, TradePlayers, TradeRepository } from "../application/ports";
import { TradeId, type Trade, type TradeItem } from "../domain/trade";
import { tradeItems, trades } from "./schema";

const StatusSchema = z.enum(["proposed", "accepted", "declined", "cancelled", "countered"]);
const SideSchema = z.enum(["proposer", "recipient"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

function itemColumns(item: TradeItem) {
  switch (item.kind) {
    case "card":
      return {
        kind: "card",
        printingId: item.printingId,
        finish: item.finish,
        quantity: item.quantity,
      };
    case "money":
      return { kind: "money", amountCents: item.amount };
    default:
      return assertNever(item);
  }
}

type ItemRow = typeof tradeItems.$inferSelect;

function toItem(row: ItemRow): TradeItem {
  const from = SideSchema.parse(row.fromSide);
  if (row.kind === "money" && row.amountCents !== null)
    return { kind: "money", from, amount: Cents.of(row.amountCents) };
  if (
    row.kind === "card" &&
    row.printingId !== null &&
    row.finish !== null &&
    row.quantity !== null
  ) {
    return {
      kind: "card",
      from,
      printingId: PrintingId.of(row.printingId),
      finish: FinishSchema.parse(row.finish),
      quantity: row.quantity,
    };
  }
  throw new Error(`trade item ${row.tradeId}/${row.position} has an impossible shape`);
}

export function drizzleTradeRepository(db: DbExecutor): TradeRepository {
  async function create(trade: NewTrade): Promise<TradeId> {
    const [row] = await db
      .insert(trades)
      .values({
        proposerId: trade.proposerId,
        recipientId: trade.recipientId,
        status: "proposed",
        message: trade.message,
        replacesId: trade.replacesId,
        createdAt: trade.createdAt,
      })
      .returning({ id: trades.id });
    await db.insert(tradeItems).values(
      trade.items.map((item, position) => ({
        tradeId: row.id,
        position,
        fromSide: item.from,
        ...itemColumns(item),
      })),
    );
    return TradeId.of(row.id);
  }

  async function lock(tradeId: TradeId): Promise<Trade | null> {
    const [row] = await db.select().from(trades).where(eq(trades.id, tradeId)).for("update");
    if (row === undefined) return null;
    const items = await db
      .select()
      .from(tradeItems)
      .where(eq(tradeItems.tradeId, tradeId))
      .orderBy(asc(tradeItems.position));
    return {
      id: TradeId.of(row.id),
      proposerId: UserId.of(row.proposerId),
      recipientId: UserId.of(row.recipientId),
      status: StatusSchema.parse(row.status),
      items: items.map(toItem),
      message: row.message,
      replacesId: row.replacesId === null ? null : TradeId.of(row.replacesId),
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  }

  async function decide(trade: Trade): Promise<void> {
    await db
      .update(trades)
      .set({ status: trade.status, decidedAt: trade.decidedAt })
      .where(eq(trades.id, trade.id));
  }

  return { create, lock, decide };
}

export function drizzleTradePlayers(db: DbExecutor): TradePlayers {
  return {
    async isActive(userId: UserId) {
      const [row] = await db
        .select({ userId: players.userId })
        .from(players)
        .where(and(eq(players.userId, userId), isNull(players.disabledAt)));
      return row !== undefined;
    },
  };
}

export function drizzleHoldings(db: DbExecutor): Holdings {
  return {
    async copies(userId: UserId, printingId: PrintingId, finish: Finish) {
      const [row] = await db
        .select({ quantity: sql<number>`${collectionCards.quantity}` })
        .from(collectionCards)
        .where(
          and(
            eq(collectionCards.userId, userId),
            eq(collectionCards.printingId, printingId),
            eq(collectionCards.finish, finish),
          ),
        );
      return row?.quantity ?? 0;
    },
  };
}
