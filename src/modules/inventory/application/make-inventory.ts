import { makeOpenAll, makeOpenItem } from "./open";
import type { InventoryDependencies } from "./ports";

/**
 * Builds the inventory use cases from one set of dependencies. (Receiving items is
 * `receiveItems`, which runs inside the store's transaction, so it isn't built here.)
 */
export function makeInventory(dependencies: InventoryDependencies) {
  return {
    openItem: makeOpenItem(dependencies),
    openAll: makeOpenAll(dependencies),
  };
}

export type Inventory = ReturnType<typeof makeInventory>;
