import { createDeckBinding } from "./create-deck";
import { drawSampleBinding } from "./draw-sample";
import { edhrecLookupBinding } from "./edhrec-lookup";
import { editDeckBinding } from "./edit-deck";
import { findCombosBinding } from "./find-combos";
import { findReplacementsBinding } from "./find-replacements";
import { getAccountBinding } from "./get-account";
import { getCardsBinding } from "./get-cards";
import { getDeckBinding } from "./get-deck";
import { listDecksBinding } from "./list-decks";
import { manageWishlistBinding } from "./manage-wishlist";
import { redditResearchBinding } from "./reddit-research";
import { rulesLookupBinding } from "./rules-lookup";
import { searchCardsBinding } from "./search-cards";
import { updateDeckBinding } from "./update-deck";
import { youtubeResearchBinding } from "./youtube-research";

/** Every tool. The registry serves these, and the transports list them. */
export const BINDINGS = [
  createDeckBinding,
  drawSampleBinding,
  edhrecLookupBinding,
  editDeckBinding,
  findCombosBinding,
  findReplacementsBinding,
  getAccountBinding,
  getCardsBinding,
  getDeckBinding,
  listDecksBinding,
  manageWishlistBinding,
  redditResearchBinding,
  rulesLookupBinding,
  searchCardsBinding,
  updateDeckBinding,
  youtubeResearchBinding,
];
