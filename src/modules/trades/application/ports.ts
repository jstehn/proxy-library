import type { ActivityServices } from "@/modules/activity";
import type { Finish, PrintingId } from "@/modules/catalog";
import type { CollectionServices } from "@/modules/collection";
import type { WalletServices } from "@/modules/wallet";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { Trade, TradeId } from "../domain/trade";

// Ports: what the trade use cases need from outside (design doc 10, section 7).

export type NewTrade = Omit<Trade, "id" | "status" | "decidedAt">;

export interface TradeRepository {
  create(trade: NewTrade): Promise<TradeId>;
  /** The trade, locked until the transaction ends (rule 6), or null. */
  lock(tradeId: TradeId): Promise<Trade | null>;
  /** Saves a decision: the new status and when it was made. */
  decide(trade: Trade): Promise<void>;
  /** The trades still waiting for a decision that a player proposed or received. */
  openInvolving(userId: UserId): Promise<TradeId[]>;
}

export interface TradePlayers {
  /** Whether the player exists and isn't disabled (rule 2). */
  isActive(userId: UserId): Promise<boolean>;
}

export interface Holdings {
  /** How many copies of a printing, in a finish, a player owns now (rule 3's early check). */
  copies(userId: UserId, printingId: PrintingId, finish: Finish): Promise<number>;
}

/** Everything a trade touches in one transaction. */
export type TradesServices = {
  trades: TradeRepository;
  tradePlayers: TradePlayers;
  holdings: Holdings;
} & WalletServices &
  CollectionServices &
  ActivityServices;

export type TradesDependencies = { unitOfWork: UnitOfWork<TradesServices>; clock: Clock };
