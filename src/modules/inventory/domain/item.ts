import type { SealedProduct, SealedProductId, SetCode } from "@/modules/catalog";
import { err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type { AlreadyOpened, ItemNotFound } from "./errors";

// Owned sealed things and their lifecycle (design doc 06, sections 3 and 7).

export type ItemId = Brand<number, "ItemId">;
export const ItemId = {
  of(raw: number): ItemId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not an item id: ${raw}`);
    return raw as ItemId;
  },
};

/** What an item is: a product to unpack, a pack to open, or a deck to open. */
export type ItemContent =
  | Readonly<{ kind: "product"; productId: SealedProductId }>
  | Readonly<{ kind: "pack"; setCode: SetCode; boosterType: string }>
  | Readonly<{ kind: "deck"; setCode: SetCode; deckName: string }>;

/** How an item came to be owned. */
export type ItemOrigin = "purchase" | "unpacked";

export type ItemStatus = "unopened" | "opened";

export type Item = Readonly<{
  id: ItemId;
  ownerId: UserId;
  content: ItemContent;
  name: string;
  /** The catalog product it was bought or unpacked as (for its art), if any. */
  productId: SealedProductId | null;
  parentId: ItemId | null;
  status: ItemStatus;
  origin: ItemOrigin;
  acquiredAt: Date;
  openedAt: Date | null;
}>;

/** An item about to be created: everything except what the database assigns. */
export type NewItem = Readonly<{
  content: ItemContent;
  name: string;
  productId: SealedProductId | null;
}>;

/**
 * The item a product becomes. A product that is exactly one pack (every booster pack product)
 * becomes that pack straight away, so buying a pack gives you a pack to open (section 3,
 * "collapsing"). Anything else becomes a product to unpack.
 */
export function itemForProduct(product: SealedProduct): NewItem {
  const [only, ...rest] = product.contents;
  if (only !== undefined && rest.length === 0 && only.kind === "pack") {
    return {
      content: { kind: "pack", setCode: only.setCode, boosterType: only.boosterType },
      name: product.name,
      productId: product.id,
    };
  }
  return {
    content: { kind: "product", productId: product.id },
    name: product.name,
    productId: product.id,
  };
}

/**
 * The only transition: unopened → opened (rule 5). Someone else's item is reported exactly like a
 * missing one, so ids can't be probed.
 */
export function openTransition(
  item: Item | null,
  userId: UserId,
  now: Date,
): Result<Item, ItemNotFound | AlreadyOpened> {
  if (item === null || item.ownerId !== userId) return err({ kind: "ItemNotFound" });
  if (item.status === "opened") return err({ kind: "AlreadyOpened" });
  return ok({ ...item, status: "opened", openedAt: now });
}
