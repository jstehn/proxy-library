import type { Finish, PrintingId, SealedProductId } from "@/modules/catalog";
import type { InventoryServices } from "@/modules/inventory";
import type { WalletServices } from "@/modules/wallet";
import type { Cents, Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { PricingMode } from "../domain/pricing";

// Ports: what the store use cases need from outside (design doc 06, section 6).

/** A product as the store sees it: can it be bought, and for how much? */
export type Listing = Readonly<{
  productId: SealedProductId;
  name: string;
  kind: string; // "booster_box/play"
  isSetEnabled: boolean;
  kindPrice: Cents | null;
  override: Cents | null;
  /** Wizards' official MSRP from its WPN product page, if it lists one (ADR 0015). */
  officialMsrp: Cents | null;
  /** Its contents' average value from the last valuation, or null if not valued (ADR 0021). */
  contentsValue: Cents | null;
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

/** A single bought from or sold to the store, with the prices and rate used (rule 8). */
export type SingleTrade = Readonly<{
  userId: UserId;
  direction: "buy" | "sell";
  printingId: PrintingId;
  finish: Finish;
  quantity: number;
  unitMarket: Cents;
  rateBps: number;
  unitPrice: Cents;
  total: Cents;
  priceDay: string;
  at: Date;
}>;

/** The store's append-only record of sales (ADR 0013). */
export interface StoreLedger {
  /** Records a sealed purchase and returns its transaction id. */
  recordSealedPurchase(purchase: SealedPurchase): Promise<number>;
  /** Records a single bought or sold and returns its transaction id. */
  recordSingle(trade: SingleTrade): Promise<number>;
}

/** The market price of one printing in one finish, and which daily snapshot it came from. */
export type MarketQuote = Readonly<{ price: Cents; day: string; isSetEnabled: boolean }>;

export interface MarketPrices {
  /** The latest price, or null if that printing has none in that finish. */
  quote(printingId: PrintingId, finish: Finish): Promise<MarketQuote | null>;
}

export interface StoreSettings {
  /** The buylist rate in basis points (5000 = 50%). */
  buylistRate(): Promise<number>;
  setBuylistRate(rateBps: number, by: UserId, at: Date): Promise<void>;
  /** How sealed product is priced: `msrp` (the default) or `value` (design doc 33). */
  pricingMode(): Promise<PricingMode>;
  setPricingMode(mode: PricingMode, by: UserId, at: Date): Promise<void>;
}

/** A product's contents value, as one valuation stores it (design doc 27, section 8). */
export type ProductValue = Readonly<{
  productId: SealedProductId;
  value: Cents;
  isPartial: boolean;
}>;

/** The store's contents values, and what a valuation reads to make them. */
export interface ProductValues {
  /** Every listed product with contents, in an enabled set: what can be for sale. */
  listedProductIds(): Promise<SealedProductId[]>;
  /** The newest day in the price history, or null when there are no prices yet. */
  newestPriceDay(): Promise<string | null>;
  /** The price day the stored values were made from, or null before the first valuation. */
  valuedPriceDay(): Promise<string | null>;
  /** Replaces every stored value with these (rule 6: all or nothing, in the caller's transaction). */
  replaceAll(values: readonly ProductValue[], priceDay: string, at: Date): Promise<void>;
}

/** Everything a purchase touches, in one transaction: the store's own records, the wallet
 * and the inventory. */
export type StoreServices = {
  priceList: PriceList;
  storeLedger: StoreLedger;
  marketPrices: MarketPrices;
  storeSettings: StoreSettings;
  productValues: ProductValues;
} & WalletServices &
  InventoryServices;

export type StoreDependencies = {
  unitOfWork: UnitOfWork<StoreServices>;
  clock: Clock;
};
