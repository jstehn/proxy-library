// The wishlist module's public API (design doc 26): the only file other modules and the app
// may import.
export { makeWishlist, type Wishlist } from "./application/make-wishlist";
export { type AddWishesReport, type WishlistView } from "./application/wishlist-tools";
export type { BuyWishError } from "./application/buy-wish";
export type { WishedForCards } from "./application/wish-for-cards";
export type { CardNeed } from "./domain/card-wishes";
export {
  deleteWishlist,
  type AddWishError,
  type UpdateWishError,
  type WishRequest,
} from "./application/manage-wishes";
export type { PrintingFacts, WishlistServices } from "./application/ports";
export {
  totals,
  wishLines,
  type Offer,
  type Paydays,
  type WalletOutlook,
  type WishLine,
  type WishStatus,
} from "./domain/lines";
export {
  MAX_NOTE_LENGTH,
  MAX_WISH_QUANTITY,
  WishId,
  type FinishPreference,
  type Wish,
  type WishDetails,
  type WishTarget,
} from "./domain/wish";
export type { SharedWishLine } from "./queries/wishlist";
export * as wishlistQueries from "./queries";
// Reads that take a player's id, for capabilities in other modules that already hold it.
export { wishesForCardOf, wishlistAnswersOf } from "./queries/of-user";
