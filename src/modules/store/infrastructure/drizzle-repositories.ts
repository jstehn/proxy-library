import { eq } from "drizzle-orm";
import { cardSets, sealedProducts } from "@/modules/catalog/infrastructure/schema";
import { SealedProductId } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import type {
  Listing,
  PriceChange,
  PriceList,
  SealedPurchase,
  StoreLedger,
} from "../application/ports";
import { productKind } from "../domain/pricing";
import { msrpOverrides, msrpPrices, storeTransactions } from "./schema";

export function drizzlePriceList(db: DbExecutor): PriceList {
  async function listing(productId: SealedProductId): Promise<Listing | null> {
    const [product] = await db
      .select({
        id: sealedProducts.id,
        name: sealedProducts.name,
        category: sealedProducts.category,
        subtype: sealedProducts.subtype,
        isSetEnabled: cardSets.isEnabled,
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

  return { recordSealedPurchase };
}
