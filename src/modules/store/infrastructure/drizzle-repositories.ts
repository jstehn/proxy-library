import { eq, sql } from "drizzle-orm";
import { cardSets, sealedProducts } from "@/modules/catalog/infrastructure/schema";
import { SealedProductId, type Finish, type PrintingId } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { Cents, type UserId } from "@/shared/kernel";
import type {
  Listing,
  MarketPrices,
  MarketQuote,
  PriceChange,
  PriceList,
  SealedPurchase,
  SingleTrade,
  StoreLedger,
  StoreSettings,
} from "../application/ports";
import { productKind } from "../domain/pricing";
import { msrpOverrides, msrpPrices, storeSettings, storeTransactions } from "./schema";

export function drizzlePriceList(db: DbExecutor): PriceList {
  async function listing(productId: SealedProductId): Promise<Listing | null> {
    const [product] = await db
      .select({
        id: sealedProducts.id,
        name: sealedProducts.name,
        category: sealedProducts.category,
        subtype: sealedProducts.subtype,
        // An empty product is never for sale (design doc 06, rule 2).
        isSetEnabled: sql<boolean>`${cardSets.isEnabled} and ${sealedProducts.isListed} and jsonb_array_length(${sealedProducts.contents}) > 0`,
        override: msrpOverrides.cents,
      })
      .from(sealedProducts)
      .innerJoin(cardSets, eq(cardSets.code, sealedProducts.setCode))
      .leftJoin(msrpOverrides, eq(msrpOverrides.productId, sealedProducts.id))
      .where(eq(sealedProducts.id, productId));
    if (product === undefined) return null;

    const kind = productKind(product.category, product.subtype);
    const [kindRow] = await db
      .select({ cents: msrpPrices.cents })
      .from(msrpPrices)
      .where(eq(msrpPrices.kind, kind));
    return {
      productId: SealedProductId.of(product.id),
      name: product.name,
      kind,
      isSetEnabled: product.isSetEnabled,
      kindPrice: kindRow === undefined ? null : Cents.of(kindRow.cents),
      override: product.override === null ? null : Cents.of(product.override),
    };
  }

  async function setKindPrice(kind: string, change: PriceChange): Promise<void> {
    if (change.price === null) {
      await db.delete(msrpPrices).where(eq(msrpPrices.kind, kind));
      return;
    }
    const row = { cents: change.price, updatedAt: change.at, updatedBy: change.by };
    await db
      .insert(msrpPrices)
      .values({ kind, ...row })
      .onConflictDoUpdate({ target: msrpPrices.kind, set: row });
  }

  async function setOverride(productId: SealedProductId, change: PriceChange): Promise<void> {
    if (change.price === null) {
      await db.delete(msrpOverrides).where(eq(msrpOverrides.productId, productId));
      return;
    }
    const row = { cents: change.price, updatedAt: change.at, updatedBy: change.by };
    await db
      .insert(msrpOverrides)
      .values({ productId, ...row })
      .onConflictDoUpdate({ target: msrpOverrides.productId, set: row });
  }

  return { listing, setKindPrice, setOverride };
}

export function drizzleStoreLedger(db: DbExecutor): StoreLedger {
  async function recordSealedPurchase(purchase: SealedPurchase): Promise<number> {
    const [row] = await db
      .insert(storeTransactions)
      .values({
        userId: purchase.userId,
        itemKind: "sealed",
        direction: "buy",
        productId: purchase.productId,
        quantity: purchase.quantity,
        unitMarketCents: purchase.unitPrice, // for sealed product, the "market" price is the MSRP
        rateBps: 10_000,
        unitPriceCents: purchase.unitPrice,
        totalCents: purchase.total,
        createdAt: purchase.at,
      })
      .returning({ id: storeTransactions.id });
    return row.id;
  }

  async function recordSingle(trade: SingleTrade): Promise<number> {
    const [row] = await db
      .insert(storeTransactions)
      .values({
        userId: trade.userId,
        itemKind: "single",
        direction: trade.direction,
        printingId: trade.printingId,
        finish: trade.finish,
        quantity: trade.quantity,
        unitMarketCents: trade.unitMarket,
        rateBps: trade.rateBps,
        unitPriceCents: trade.unitPrice,
        totalCents: trade.total,
        priceDay: trade.priceDay,
        createdAt: trade.at,
      })
      .returning({ id: storeTransactions.id });
    return row.id;
  }

  return { recordSealedPurchase, recordSingle };
}

export function drizzleMarketPrices(db: DbExecutor): MarketPrices {
  async function quote(printingId: PrintingId, finish: Finish): Promise<MarketQuote | null> {
    const result = await db.execute<{ usd_cents: number; day: string; is_enabled: boolean }>(sql`
      select s.usd_cents, s.day::text as day, cs.is_enabled
        from price_snapshots s
        join printings p on p.id = s.printing_id
        join card_sets cs on cs.code = p.set_code
       where s.printing_id = ${printingId} and s.finish = ${finish}
       order by s.day desc
       limit 1
    `);
    const [row] = result.rows;
    if (row === undefined) return null;
    return { price: Cents.of(Number(row.usd_cents)), day: row.day, isSetEnabled: row.is_enabled };
  }

  return { quote };
}

const SETTINGS_ROW_ID = 1;

export function drizzleStoreSettings(db: DbExecutor): StoreSettings {
  async function buylistRate(): Promise<number> {
    const [row] = await db
      .select({ rate: storeSettings.buylistRateBps })
      .from(storeSettings)
      .where(eq(storeSettings.id, SETTINGS_ROW_ID));
    if (row === undefined) throw new Error("store_settings has no row: run the migrations");
    return row.rate;
  }

  async function setBuylistRate(rateBps: number, by: UserId, at: Date): Promise<void> {
    await db
      .update(storeSettings)
      .set({ buylistRateBps: rateBps, updatedAt: at, updatedBy: by })
      .where(eq(storeSettings.id, SETTINGS_ROW_ID));
  }

  return { buylistRate, setBuylistRate };
}
