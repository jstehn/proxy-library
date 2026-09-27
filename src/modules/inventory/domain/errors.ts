// Every expected failure in the inventory module.
export type ItemNotFound = Readonly<{ kind: "ItemNotFound" }>;
export type AlreadyOpened = Readonly<{ kind: "AlreadyOpened" }>;
/** A pack whose booster recipe is gone from the catalog. */
export type BoosterUnavailable = Readonly<{ kind: "BoosterUnavailable" }>;
/** A deck whose deck list is gone from the catalog. */
export type DeckUnavailable = Readonly<{ kind: "DeckUnavailable" }>;
/** A product (or a product inside it) that is gone from the catalog. */
export type ProductUnavailable = Readonly<{ kind: "ProductUnavailable" }>;
