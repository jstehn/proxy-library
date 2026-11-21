import { pick } from "@/shared/kernel";
import type { Inventory } from "./application/make-inventory";

// The inventory module's capabilities (ADR 0026): only what callers use.

export function wireInventoryCapabilities({ inventory }: Readonly<{ inventory: Inventory }>) {
  return { inventory: pick(inventory, "openItem", "openAll") };
}
