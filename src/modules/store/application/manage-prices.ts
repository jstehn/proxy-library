import type { Actor } from "@/modules/accounts";
import type { SealedProductId } from "@/modules/catalog";
import { err, ok, type Cents, type Result } from "@/shared/kernel";
import type { Forbidden, PriceInvalid, ProductNotFound } from "../domain/errors";
import { checkPrice } from "../domain/pricing";
import type { StoreDependencies } from "./ports";

export type SetKindPriceError = Forbidden | PriceInvalid;
export type SetProductPriceError = Forbidden | PriceInvalid | ProductNotFound;

/** Null clears a price. Anything else must be a valid price. */
function checkOptionalPrice(price: Cents | null): Result<Cents | null, PriceInvalid> {
  return price === null ? ok(null) : checkPrice(price);
}

/** Admins set MSRPs per product kind, and per product (design doc 06, rule 8). */
export function makeManagePrices(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function setKindPrice(
    actor: Actor,
    input: { kind: string; price: Cents | null },
  ): Promise<Result<void, SetKindPriceError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const price = checkOptionalPrice(input.price);
    if (!price.ok) return price;
    return unitOfWork.run<void, SetKindPriceError>(async ({ priceList }) => {
      await priceList.setKindPrice(input.kind, {
        price: price.value,
        by: actor.userId,
        at: clock.now(),
      });
      return ok();
    });
  }

  async function setProductPrice(
    actor: Actor,
    input: { productId: SealedProductId; price: Cents | null },
  ): Promise<Result<void, SetProductPriceError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const price = checkOptionalPrice(input.price);
    if (!price.ok) return price;
    return unitOfWork.run<void, SetProductPriceError>(async ({ priceList }) => {
      if ((await priceList.listing(input.productId)) === null) {
        return err({ kind: "ProductNotFound" });
      }
      await priceList.setOverride(input.productId, {
        price: price.value,
        by: actor.userId,
        at: clock.now(),
      });
      return ok();
    });
  }

  return { setKindPrice, setProductPrice };
}
