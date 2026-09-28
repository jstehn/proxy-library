import type { UserId } from "@/shared/kernel";
import type { InventoryServices } from "./ports";

/**
 * Deletes every sealed item a player has, opened or not, inside the caller's transaction (an
 * admin resetting a player). The cards they produced are the collection's business. Returns how
 * many items went.
 */
export async function discardAllItems(
  services: Pick<InventoryServices, "items">,
  ownerId: UserId,
): Promise<number> {
  return services.items.removeAllOf(ownerId);
}
