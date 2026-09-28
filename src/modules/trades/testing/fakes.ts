import { PrintingId } from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";
import type { Holdings, NewTrade, TradePlayers, TradeRepository } from "../application/ports";
import { TradeId, type Trade } from "../domain/trade";

// In-memory stand-ins for the trades ports.

export function inMemoryTradeRepository() {
  const trades = new Map<TradeId, Trade>();
  let lastId = 0;
  const repository: TradeRepository = {
    async create(trade: NewTrade) {
      const id = TradeId.of(++lastId);
      trades.set(id, { ...trade, id, status: "proposed", decidedAt: null });
      return id;
    },
    async lock(tradeId) {
      return trades.get(tradeId) ?? null;
    },
    async decide(trade) {
      trades.set(trade.id, trade);
    },
    async openInvolving(userId) {
      return [...trades.values()]
        .filter(
          (trade) =>
            trade.status === "proposed" &&
            (trade.proposerId === userId || trade.recipientId === userId),
        )
        .map((trade) => trade.id);
    },
  };
  return { ...repository, get: (tradeId: TradeId) => trades.get(tradeId) };
}

export function inMemoryTradePlayers(active: readonly string[]): TradePlayers {
  return {
    async isActive(userId: UserId) {
      return active.includes(userId);
    },
  };
}

/** Holdings read from a collection fake's quantities. */
export function holdingsFrom(
  quantity: (userId: UserId, printingId: string, finish: "nonfoil" | "foil" | "etched") => number,
): Holdings {
  return {
    async copies(userId, printingId, finish) {
      return quantity(userId, printingId, finish);
    },
  };
}

export function tradeCard(from: "proposer" | "recipient", printingId: string, quantity = 1) {
  return {
    kind: "card" as const,
    from,
    printingId: PrintingId.of(printingId),
    finish: "nonfoil" as const,
    quantity,
  };
}
