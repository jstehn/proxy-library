// The inventory module's public API: the only file other modules and the app may import.
export { discardAllItems } from "./application/discard-all-items";
export { makeInventory, type Inventory } from "./application/make-inventory";
export { type Opening, type OpenItemError } from "./application/open";
export { openPackForDraft } from "./application/open-pack-for-draft";
export type { InventoryServices } from "./application/ports";
export { receiveItems } from "./application/receive-items";
export type {
  AlreadyOpened,
  BoosterUnavailable,
  DeckUnavailable,
  ItemNotFound,
  NothingInside,
  ProductUnavailable,
} from "./domain/errors";
export { ItemId, type Item } from "./domain/item";
export { productProblems } from "./domain/unpack";
export {
  openingView,
  recentOpenings,
  unopenedItems,
  type OpenedCard,
  type OpeningView,
  type UnopenedGroup,
} from "./queries/inventory";
