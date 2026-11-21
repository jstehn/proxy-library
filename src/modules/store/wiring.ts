import { pickForAdmin } from "@/modules/accounts";
import { pick } from "@/shared/kernel";
import type { Store } from "./application/make-store";

// The store's capabilities (ADR 0026): only what callers use. The price settings are for admins.

export function wireStoreCapabilities({ store }: Readonly<{ store: Store }>) {
  return {
    store: {
      ...pick(store, "buySingle", "sellSingle", "buySealed", "buyList"),
      ...pickForAdmin(store, "setBuylistRate", "setKindPrice", "setPricingMode", "setProductPrice"),
    },
  };
}
