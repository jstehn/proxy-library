// The store module's public API: the only file other modules and the app may import.
export type { BuyListError, BuyListInput, ListReceipt } from "./application/buy-list";
export type { BuySealedError, BuySealedInput, SealedReceipt } from "./application/buy-sealed";
export { makeStore, type Store } from "./application/make-store";
export type { SetKindPriceError, SetProductPriceError } from "./application/manage-prices";
export type {
  Listing,
  PriceList,
  StoreDependencies,
  StoreLedger,
  StoreServices,
} from "./application/ports";
export { MAX_QUANTITY, productKind } from "./domain/pricing";
export type {
  BuySingleError,
  SellSingleError,
  SingleInput,
  SingleReceipt,
} from "./application/singles";
export { DEFAULT_BUYLIST_RATE_BPS, payoutPerCopy } from "./domain/singles";
export {
  MAX_LIST_LINES,
  type Candidate,
  type ListQuote,
  type PrintingPreference,
  type QuoteLine,
  type QuoteOptions,
} from "./domain/shopping-list";
export { quoteShoppingList } from "./queries/shopping-list";
export {
  currentBuylistRate,
  singleHistory,
  type SingleHistoryRow,
  kindPrices,
  packMsrp,
  productPrices,
  storePage,
  storeSets,
  type FeaturedArt,
  type KindPriceRow,
  type ProductForSale,
  type ProductPriceRow,
  type StorePage,
  type StoreSet,
} from "./queries/store";
