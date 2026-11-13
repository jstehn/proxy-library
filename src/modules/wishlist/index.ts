// The wishlist module's public API (design doc 26): the only file other modules and the app
// may import.
export { makeWishlist, type Wishlist } from "./application/make-wishlist";
export type { BoughtWish, BuyWishError, BuyWishInput } from "./application/buy-wish";
export type { WishedForCards } from "./application/wish-for-cards";
export type { CardNeed } from "./domain/card-wishes";
export {
  deleteWishlist,
  type AddedWish,
  type AddWishError,
  type AddWishInput,
  type UpdateWishError,
  type WishRequest,
} from "./application/manage-wishes";
export type {
  NewWish,
  PrintingFacts,
  WishCatalog,
  WishlistDependencies,
  WishlistServices,
  WishRepository,
} from "./application/ports";
export {
  totals,
  wishLines,
  type Offer,
  type Paydays,
  type WalletOutlook,
  type WishLine,
  type WishlistTotals,
  type WishStatus,
} from "./domain/lines";
export {
  FINISH_PREFERENCES,
  MAX_NOTE_LENGTH,
  MAX_TARGET_PRICE,
  MAX_WISH_QUANTITY,
  MAX_WISHES,
  WishId,
  type FinishPreference,
  type Wish,
  type WishDetails,
  type WishTarget,
} from "./domain/wish";
export {
  isWishlistShared,
  sharedWishlistFor,
  sharedWishlists,
  wishedPrintings,
  wishesAtTarget,
  wishesForCard,
  wishlistAnswers,
  type SharedWishCopy,
  type SharedWishLine,
  type SharedWishlist,
  type SharedWishlistSummary,
} from "./queries/wishlist";
