import type { SealedProductId } from "@/modules/catalog";
import type { Cents } from "@/shared/kernel";
import type { Listing, PriceList, SealedPurchase, StoreLedger } from "../application/ports";

// In-memory stand-ins for the store ports.

export function inMemoryPriceList(listings: readonly Listing[]) {
  const byId = new Map(listings.map((listing) => [listing.productId, listing]));
  const kindPrices = new Map<string, Cents>();

  const priceList: PriceList = {
    async listing(productId) {
      const listing = byId.get(productId);
      if (listing === undefined) return null;
      return { ...listing, kindPrice: kindPrices.get(listing.kind) ?? listing.kindPrice };
    },
    async setKindPrice(kind, change) {
      if (change.price === null) kindPrices.delete(kind);
      else kindPrices.set(kind, change.price);
      for (const [id, listing] of byId) {
        if (listing.kind === kind) byId.set(id, { ...listing, kindPrice: change.price });
      }
    },
    async setOverride(productId: SealedProductId, change) {
      const listing = byId.get(productId);
      if (listing !== undefined) byId.set(productId, { ...listing, override: change.price });
    },
  };
  return priceList;
}

export function inMemoryStoreLedger() {
  const purchases: SealedPurchase[] = [];
  const ledger: StoreLedger = {
    async recordSealedPurchase(purchase) {
      purchases.push(purchase);
      return purchases.length;
    },
  };
  return { ...ledger, purchases };
}
