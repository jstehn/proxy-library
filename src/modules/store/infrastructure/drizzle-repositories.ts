import { and, eq, sql } from "drizzle-orm";
import {
  cardSets,
  productWpnLinks,
  sealedProducts,
  wpnProducts,
} from "@/modules/catalog/infrastructure/schema";
import { SealedProductId, type Finish, type PrintingId } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { Cents, type UserId } from "@/shared/kernel";
import type {
  ProductValues,
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
import { kindPriceApplies, productKind, type PricingMode } from "../domain/pricing";
import {
  msrpOverrides,
  msrpPrices,
  productValues,
  storeSettings,
  storeTransactions,
} from "./schema";

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
        officialMsrp: wpnProducts.msrpCents,
        contentsValue: productValues.valueCents,
      })
      .from(sealedProducts)
      .innerJoin(cardSets, eq(cardSets.code, sealedProducts.setCode))
      .leftJoin(msrpOverrides, eq(msrpOverrides.productId, sealedProducts.id))
      .leftJoin(productValues, eq(productValues.productId, sealedProducts.id))
      .leftJoin(productWpnLinks, eq(productWpnLinks.productId, sealedProducts.id))
      .leftJoin(
        wpnProducts,
        and(
          eq(wpnProducts.setCode, productWpnLinks.wpnSetCode),
          eq(wpnProducts.name, productWpnLinks.wpnName),
        ),
      )
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
      kindPrice:
        kindRow === undefined || !kindPriceApplies(product.name) ? null : Cents.of(kindRow.cents),
      override: product.override === null ? null : Cents.of(product.override),
      officialMsrp: product.officialMsrp === null ? null : Cents.of(product.officialMsrp),
      contentsValue: product.contentsValue === null ? null : Cents.of(product.contentsValue),
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

  async function pricingMode(): Promise<PricingMode> {
    const [row] = await db
      .select({ mode: storeSettings.pricingMode })
      .from(storeSettings)
      .where(eq(storeSettings.id, SETTINGS_ROW_ID));
    if (row === undefined) throw new Error("store_settings has no row: run the migrations");
    // The table's check allows only these two (migration 0034).
    return row.mode === "value" ? "value" : "msrp";
  }

  async function setPricingMode(mode: PricingMode, by: UserId, at: Date): Promise<void> {
    await db
      .update(storeSettings)
      .set({ pricingMode: mode, updatedAt: at, updatedBy: by })
      .where(eq(storeSettings.id, SETTINGS_ROW_ID));
  }

  return { buylistRate, setBuylistRate, pricingMode, setPricingMode };
}

export function drizzleProductValues(db: DbExecutor): ProductValues {
  return {
    async listedProductIds() {
      const rows = await db.execute<{ id: string }>(sql`
        select sp.id from sealed_products sp
          join card_sets s on s.code = sp.set_code and s.is_enabled
         where sp.is_listed and jsonb_array_length(sp.contents) > 0
         order by sp.id
      `);
      return rows.rows.map((row) => SealedProductId.of(row.id));
    },

    async newestPriceDay() {
      const [row] = (
        await db.execute<{ day: string | null }>(
          sql`select max(day)::text as day from price_snapshots`,
        )
      ).rows;
      return row?.day ?? null;
    },

    async valuedPriceDay() {
      const [row] = (
        await db.execute<{ day: string | null }>(
          sql`select max(price_day)::text as day from product_values`,
        )
      ).rows;
      return row?.day ?? null;
    },

    async replaceAll(values, priceDay, at) {
      await db.delete(productValues);
      // Postgres takes at most 65,535 parameters per statement; 5 per row, 1,000 rows at a time.
      for (let start = 0; start < values.length; start += 1000) {
        await db.insert(productValues).values(
          values.slice(start, start + 1000).map((value) => ({
            productId: value.productId,
            valueCents: value.value,
            isPartial: value.isPartial,
            priceDay,
            valuedAt: at,
          })),
        );
      }
    },
  };
}
