// The trades module's public API: the only file other modules and the app may import.
export type {
  Holdings,
  NewTrade,
  TradePlayers,
  TradeRepository,
  TradesDependencies,
  TradesServices,
} from "./application/ports";
export { closeOpenTrades } from "./application/close-open-trades";
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
export { TradeId, type TradeItem, type TradeSide } from "./domain/trade";
export type { TradeItemView, TradeView, TradingPartner } from "./queries/trades";
export * as tradeQueries from "./queries";
