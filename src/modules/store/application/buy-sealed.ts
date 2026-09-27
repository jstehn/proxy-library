import type { Actor } from "@/modules/accounts";
import type { SealedProductId } from "@/modules/catalog";
import { receiveItems, type Item } from "@/modules/inventory";
import { spend, type InsufficientFunds } from "@/modules/wallet";
import { err, ok, type Result } from "@/shared/kernel";
import type { ProductNotForSale, QuantityInvalid } from "../domain/errors";
import { checkQuantity, msrpFor, totalPrice } from "../domain/pricing";
import type { StoreDependencies } from "./ports";

export type BuySealedError = ProductNotForSale | QuantityInvalid | InsufficientFunds;

export type BuySealedInput = Readonly<{ productId: SealedProductId; quantity: number }>;

export type SealedReceipt = Readonly<{ transactionId: number; items: readonly Item[] }>;

/**
 * Buys sealed product at MSRP (design doc 06, rules 1–4). The store transaction, the wallet
 * debit and the new items are saved in one transaction: if the wallet can't pay, nothing is.
 */
export function makeBuySealed(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function buySealed(
    actor: Actor,
    input: BuySealedInput,
  ): Promise<Result<SealedReceipt, BuySealedError>> {
    const quantity = checkQuantity(input.quantity);
    if (!quantity.ok) return quantity;

    return unitOfWork.run<SealedReceipt, BuySealedError>(async (services) => {
      const listing = await services.priceList.listing(input.productId);
      const unitPrice = listing === null ? null : msrpFor(listing);
      if (listing === null || !listing.isSetEnabled || unitPrice === null) {
        return err({ kind: "ProductNotForSale" });
      }

      const now = clock.now();
      const total = totalPrice(unitPrice, quantity.value);
      const transactionId = await services.storeLedger.recordSealedPurchase({
        userId: actor.userId,
        productId: input.productId,
        quantity: quantity.value,
        unitPrice,
        total,
        at: now,
      });

      const paid = await spend(services, {
        userId: actor.userId,
        amount: total,
        kind: "purchase_sealed",
        note: quantity.value === 1 ? listing.name : `${quantity.value} × ${listing.name}`,
        ref: `store:${transactionId}`,
        now,
      });
      // Returning an error rolls the whole transaction back, store record included.
      if (!paid.ok) return paid;

      const items = await receiveItems(services, {
        ownerId: actor.userId,
        productId: input.productId,
        quantity: quantity.value,
        origin: "purchase",
        now,
      });
      if (!items.ok) return err({ kind: "ProductNotForSale" });
      return ok({ transactionId, items: items.value });
    });
  }

  return buySealed;
}
