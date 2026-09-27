// The trades module's public API: the only file other modules and the app may import.
export type {
  Holdings,
  NewTrade,
  TradePlayers,
  TradeRepository,
  TradesDependencies,
  TradesServices,
} from "./application/ports";
export {
  makeTrades,
  type AcceptTradeError,
  type CounterTradeError,
  type DecideError,
  type ProposeInput,
  type ProposeTradeError,
  type Trades,
} from "./application/trades";
export type { Shortfall } from "./domain/errors";
export {
  MAX_CARD_QUANTITY,
  MAX_MESSAGE_LENGTH,
  MAX_MONEY,
  TradeId,
  type TradeItem,
  type TradeSide,
} from "./domain/trade";
export {
  tradesFor,
  tradesWaitingForYou,
  tradeView,
  tradingPartners,
  type TradeItemView,
  type TradeView,
  type TradingPartner,
} from "./queries/trades";
