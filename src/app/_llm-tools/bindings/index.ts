import { findReplacementsBinding } from "./find-replacements";
import { getAccountBinding } from "./get-account";
import { getCardsBinding } from "./get-cards";
import { getDeckBinding } from "./get-deck";
import { listDecksBinding } from "./list-decks";
import { manageWishlistBinding } from "./manage-wishlist";

/** Every ported tool. The registry serves these first, then the old tools for the rest. */
export const BINDINGS = [
  findReplacementsBinding,
  getAccountBinding,
  getCardsBinding,
  getDeckBinding,
  listDecksBinding,
  manageWishlistBinding,
];
