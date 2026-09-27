import type { SealedProductId } from "@/modules/catalog";
import type { InventoryServices } from "@/modules/inventory";
import type { WalletServices } from "@/modules/wallet";
import type { Cents, Clock, UnitOfWork, UserId } from "@/shared/kernel";

// Ports: what the store use cases need from outside (design doc 06, section 6).

/** A product as the store sees it: can it be bought, and for how much? */
export type Listing = Readonly<{
  productId: SealedProductId;
  name: string;
  kind: string; // "booster_box/play"
  isSetEnabled: boolean;
  kindPrice: Cents | null;
  override: Cents | null;
}>;

export type PriceChange = Readonly<{ price: Cents | null; by: UserId; at: Date }>;

export interface PriceList {
  /** A product's listing, or null if the catalog has no such product. */
  listing(productId: SealedProductId): Promise<Listing | null>;
  /** Sets (or, with null, clears) the MSRP for every product of one kind. */
  setKindPrice(kind: string, change: PriceChange): Promise<void>;
  /** Sets (or clears) one product's own MSRP. */
  setOverride(productId: SealedProductId, change: PriceChange): Promise<void>;
}

export type SealedPurchase = Readonly<{
  userId: UserId;
  productId: SealedProductId;
  quantity: number;
  unitPrice: Cents;
  total: Cents;
  at: Date;
}>;

/** The store's append-only record of sales (ADR 0013). */
export interface StoreLedger {
  /** Records a sealed purchase and returns its transaction id. */
  recordSealedPurchase(purchase: SealedPurchase): Promise<number>;
}

/** Everything a purchase touches, in one transaction: the store's own records, the wallet
 * and the inventory. */
export type StoreServices = {
  priceList: PriceList;
  storeLedger: StoreLedger;
} & WalletServices &
  InventoryServices;

export type StoreDependencies = {
  unitOfWork: UnitOfWork<StoreServices>;
  clock: Clock;
};
