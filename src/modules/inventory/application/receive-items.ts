import type { SealedProductId } from "@/modules/catalog";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { ProductUnavailable } from "../domain/errors";
import { itemForProduct, type Item, type ItemOrigin } from "../domain/item";
import type { InventoryServices } from "./ports";

export type ReceiveItemsInput = Readonly<{
  ownerId: UserId;
  productId: SealedProductId;
  quantity: number;
  origin: ItemOrigin;
  now: Date;
}>;

/**
 * Gives a player `quantity` copies of a product as unopened items, inside the caller's
 * transaction (the store calls this when a purchase is paid for).
 */
export async function receiveItems(
  services: InventoryServices,
  input: ReceiveItemsInput,
): Promise<Result<Item[], ProductUnavailable>> {
  const product = (await services.productCatalog.products([input.productId])).get(input.productId);
  if (product === undefined) return err({ kind: "ProductUnavailable" });
  const item = itemForProduct(product);
  return ok(
    await services.items.add({
      ownerId: input.ownerId,
      items: Array.from({ length: input.quantity }, () => item),
      origin: input.origin,
      parentId: null,
      at: input.now,
    }),
  );
}
