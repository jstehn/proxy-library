import type { SealedProduct, SealedProductId, SetCode } from "@/modules/catalog";
import type { CardGain, CollectionServices } from "@/modules/collection";
import type { PackCard, PacksServices, SeedSource } from "@/modules/packs";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { Item, ItemId, ItemOrigin, NewItem } from "../domain/item";

// Ports: what the inventory use cases need from outside (design doc 06, section 6).

/** What an opening produced, as stored with the item (rule 6). */
export type StoredOpening =
  | Readonly<{ kind: "pack"; seed: string; variantIndex: number; cards: readonly PackCard[] }>
  | Readonly<{ kind: "deck"; cards: readonly CardGain[] }>
  | Readonly<{
      kind: "product";
      seed: string;
      childIds: readonly ItemId[];
      cards: readonly CardGain[];
      extras: readonly string[];
    }>;

export type NewItemsInput = Readonly<{
  ownerId: UserId;
  items: readonly NewItem[];
  origin: ItemOrigin;
  parentId: ItemId | null;
  at: Date;
}>;

export interface ItemRepository {
  /** Creates items and returns them with their ids, in the same order. */
  add(input: NewItemsInput): Promise<Item[]>;
  /** Reads an item and locks it until the transaction ends (null if there's no such item). */
  lock(itemId: ItemId): Promise<Item | null>;
  /** Saves an item as opened, with what the opening produced. */
  markOpened(item: Item, opening: StoredOpening): Promise<void>;
}

/** One card of a deck list: copies, and which board (commander, main or side) they go on. */
export type DeckCardGain = CardGain & Readonly<{ board: "commander" | "main" | "side" }>;

/** A deck list as it comes out of its box. */
export type DeckContents = Readonly<{
  type: string; // "Commander Deck", "Starter Kit", "Bundle Land Pack", …
  cards: readonly DeckCardGain[];
}>;

/** Reads sealed products and deck lists from the catalog. */
export interface ProductCatalog {
  /** These products, by id. Unknown ids are missing from the map. */
  products(productIds: readonly SealedProductId[]): Promise<Map<SealedProductId, SealedProduct>>;
  /** A deck list's type and every card in it (all boards), or null if there's no such deck. */
  deckCards(setCode: SetCode, deckName: string): Promise<DeckContents | null>;
}

/** The repositories that must share one transaction: inventory's, plus the pack engine's
 * and the collection's, because opening a pack uses all three. */
export type InventoryServices = {
  items: ItemRepository;
  productCatalog: ProductCatalog;
} & PacksServices &
  CollectionServices;

export type InventoryDependencies = {
  unitOfWork: UnitOfWork<InventoryServices>;
  clock: Clock;
  seeds: SeedSource;
};
