// The store module's public API: the only file other modules and the app may import.
export type { BuyListError } from "./application/buy-list";

export { makeStore, type Store } from "./application/make-store";

export type { Listing, StoreServices } from "./application/ports";
export { MAX_QUANTITY, PRICING_MODES, storePrice, type PricingMode } from "./domain/pricing";

export {
  buySingleIn,
  type BuySingleError,
  type BuySingleInError,
  type SellSingleError,
  type SingleReceipt,
} from "./application/singles";
export type { PricesChanged } from "./domain/errors";
export { payoutPerCopy } from "./domain/singles";
export {
  MAX_LIST_LINES,
  type Candidate,
  type ListQuote,
  type PrintingPreference,
  type QuoteLine,
  type QuoteOptions,
} from "./domain/shopping-list";
export type { ProductForSale, StorePage } from "./queries/store";
export type { SingleHistoryRow } from "./queries/store-prices";
export { packMsrp } from "./queries/pack-msrp";
export * as storeQueries from "./queries";
export {
  describeBuyListError,
  describeBuySealedError,
  describeBuySingleError,
  describeSellSingleError,
} from "./application/describe-error";
