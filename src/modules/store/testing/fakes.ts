import type { Finish, PrintingId, SealedProductId } from "@/modules/catalog";
import type { Cents } from "@/shared/kernel";
import type {
  Listing,
  MarketPrices,
  MarketQuote,
  PriceList,
  SealedPurchase,
  SingleTrade,
  StoreLedger,
  StoreSettings,
} from "../application/ports";
import { DEFAULT_BUYLIST_RATE_BPS } from "../domain/singles";

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
  const singles: SingleTrade[] = [];
  let lastId = 0;
  const ledger: StoreLedger = {
    async recordSealedPurchase(purchase) {
      purchases.push(purchase);
      return ++lastId;
    },
    async recordSingle(trade) {
      singles.push(trade);
      return ++lastId;
    },
  };
  return { ...ledger, purchases, singles };
}

/** Market prices from a table: `"printingId/finish"` → quote. */
export function inMemoryMarketPrices(quotes: Readonly<Record<string, MarketQuote>>): MarketPrices {
  return {
    async quote(printingId: PrintingId, finish: Finish) {
      return quotes[`${printingId}/${finish}`] ?? null;
    },
  };
}

export function inMemoryStoreSettings(rateBps = DEFAULT_BUYLIST_RATE_BPS): StoreSettings {
  let rate = rateBps;
  return {
    async buylistRate() {
      return rate;
    },
    async setBuylistRate(newRate) {
      rate = newRate;
    },
  };
}
