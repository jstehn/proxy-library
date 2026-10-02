// The inventory module's public API: the only file other modules and the app may import.
export { discardAllItems } from "./application/discard-all-items";
export { makeInventory, type Inventory } from "./application/make-inventory";
export { OPEN_ALL_LIMIT, type Opening, type OpenItemError } from "./application/open";
export { openPackForDraft } from "./application/open-pack-for-draft";
export type {
  DeckCardGain,
  DeckContents,
  InventoryDependencies,
  InventoryServices,
  ItemRepository,
  ProductCatalog,
  StoredOpening,
} from "./application/ports";
export { receiveItems, type ReceiveItemsInput } from "./application/receive-items";
export type {
  AlreadyOpened,
  BoosterUnavailable,
  DeckUnavailable,
  ItemNotFound,
  NotAPack,
  NothingInside,
  ProductUnavailable,
} from "./domain/errors";
export { ItemId, type Item, type ItemContent } from "./domain/item";
export { productProblems, type CatalogKnowledge } from "./domain/unpack";
export {
  openingView,
  recentOpenings,
  unopenedItems,
  type OpenedCard,
  type OpeningView,
  type RecentOpening,
  type UnopenedGroup,
} from "./queries/inventory";
