import {
  PrintingId,
  SealedProductId,
  SetCode,
  type SealedContent,
  type SealedProduct,
} from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";
import type {
  DeckCardGain,
  ItemRepository,
  NewItemsInput,
  ProductCatalog,
  StoredOpening,
} from "../application/ports";
import { ItemId, type Item } from "../domain/item";

// In-memory stand-ins for the inventory ports, and sample products to open.

export function inMemoryItemRepository() {
  const items = new Map<ItemId, Item>();
  const openings = new Map<ItemId, StoredOpening>();
  let nextId = 1;

  const repository: ItemRepository = {
    async add(input: NewItemsInput) {
      return input.items.map((newItem) => {
        const item: Item = {
          ...newItem,
          id: ItemId.of(nextId++),
          ownerId: input.ownerId,
          parentId: input.parentId,
          status: "unopened",
          origin: input.origin,
          acquiredAt: input.at,
          openedAt: null,
        };
        items.set(item.id, item);
        return item;
      });
    },
    async lock(itemId) {
      return items.get(itemId) ?? null;
    },
    async markOpened(item, opening) {
      items.set(item.id, item);
      openings.set(item.id, opening);
    },
  };

  return {
    ...repository,
    /** Every item a player has, in creation order (for test assertions). */
    itemsOf(ownerId: UserId): Item[] {
      return [...items.values()].filter((item) => item.ownerId === ownerId);
    },
    openingOf(itemId: ItemId): StoredOpening | undefined {
      return openings.get(itemId);
    },
  };
}

export function inMemoryProductCatalog(
  products: readonly SealedProduct[],
  decks: ReadonlyMap<string, readonly DeckCardGain[]> = new Map(),
): ProductCatalog {
  return {
    async products(productIds) {
      const found = new Map<SealedProductId, SealedProduct>();
      for (const product of products) {
        if (productIds.includes(product.id)) found.set(product.id, product);
      }
      return found;
    },
    async deckCards(setCode, deckName) {
      const cards = decks.get(`${setCode}/${deckName}`);
      return cards === undefined ? null : { type: "Theme Deck", cards };
    },
  };
}

/** A made-up product in the sample booster's set ("TST", see packs/testing/recipes.ts). */
export function sampleProduct(
  id: string,
  name: string,
  contents: SealedContent[],
  category = "bundle",
): SealedProduct {
  return {
    id: SealedProductId.of(id),
    setCode: SetCode.of("TST"),
    name,
    category,
    subtype: null,
    releaseDate: null,
    contents,
  };
}

const TST = SetCode.of("TST");

/** Sample products: a pack, a box of 3 packs, a bundle with extras, a kit with a random deck. */
export const SAMPLE_PRODUCTS = {
  pack: sampleProduct(
    "pack",
    "Test Play Booster Pack",
    [{ kind: "pack", setCode: TST, boosterType: "play" }],
    "booster_pack",
  ),
  box: sampleProduct(
    "box",
    "Test Play Booster Box",
    [{ kind: "sealed", productId: SealedProductId.of("pack"), count: 3 }],
    "booster_box",
  ),
  bundle: sampleProduct("bundle", "Test Bundle", [
    { kind: "card", printingId: PrintingId.of("m-1"), finish: "foil" },
    { kind: "sealed", productId: SealedProductId.of("pack"), count: 2 },
    { kind: "deck", setCode: TST, deckName: "Land Pack" },
    { kind: "other", name: "Spindown" },
  ]),
  kit: sampleProduct("kit", "Test Starter Kit", [
    {
      kind: "variable",
      options: [
        [{ kind: "deck", setCode: TST, deckName: "Land Pack" }],
        [{ kind: "deck", setCode: TST, deckName: "Other Deck" }],
      ],
    },
  ]),
} as const;

/** The sample decks: "TST/Land Pack" has 5 Forests and 5 Islands. */
export const SAMPLE_DECKS: ReadonlyMap<string, readonly DeckCardGain[]> = new Map([
  [
    "TST/Land Pack",
    [
      { printingId: PrintingId.of("l-forest"), finish: "nonfoil", quantity: 5, board: "main" },
      { printingId: PrintingId.of("l-island"), finish: "nonfoil", quantity: 5, board: "main" },
    ],
  ],
  [
    "TST/Other Deck",
    [{ printingId: PrintingId.of("c-W1"), finish: "nonfoil", quantity: 2, board: "main" }],
  ],
]);
