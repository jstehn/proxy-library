import type { Finish, PrintingId } from "@/modules/catalog";
import type { Cents } from "@/shared/kernel";
import type { TradeSide, TradeStatus } from "./trade";

// Every expected failure in the trades module.
export type TradeNotFound = Readonly<{ kind: "TradeNotFound" }>;
export type AlreadyDecided = Readonly<{ kind: "AlreadyDecided"; status: TradeStatus }>;
export type CannotTradeWithYourself = Readonly<{ kind: "CannotTradeWithYourself" }>;
export type PlayerNotFound = Readonly<{ kind: "PlayerNotFound" }>;
export type OfferInvalid = Readonly<{ kind: "OfferInvalid"; reason: string }>;

/** What makes a trade impossible right now: someone no longer has the cards or the money. */
export type Shortfall =
  | Readonly<{
      what: "cards";
      side: TradeSide;
      printingId: PrintingId;
      finish: Finish;
      owned: number;
      needed: number;
    }>
  | Readonly<{ what: "money"; side: TradeSide; balance: Cents; needed: Cents }>;

/** At proposal time (rule 3). */
export type OfferNotPossible = Readonly<{ kind: "OfferNotPossible"; shortfall: Shortfall }>;
/** At acceptance (rule 4): something changed since the proposal. */
export type NoLongerPossible = Readonly<{ kind: "NoLongerPossible"; shortfall: Shortfall }>;
