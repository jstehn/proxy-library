import { makeBuyWish } from "./buy-wish";
import { makeManageWishes } from "./manage-wishes";
import type { WishlistDependencies } from "./ports";
import { makeWishForCards } from "./wish-for-cards";

/** The wishlist's use cases, wired with one set of dependencies (design doc 26). */
export function makeWishlist(dependencies: WishlistDependencies) {
  return {
    ...makeManageWishes(dependencies),
    buyWish: makeBuyWish(dependencies),
    wishForCards: makeWishForCards(dependencies),
  };
}

export type Wishlist = ReturnType<typeof makeWishlist>;
