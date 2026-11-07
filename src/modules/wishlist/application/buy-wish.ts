import type { Actor } from "@/modules/accounts";
import { PrintingId, type Finish } from "@/modules/catalog";
import { buySingleIn, type BuySingleInError, type SingleReceipt } from "@/modules/store";
import { err, ok, type Cents, type Result } from "@/shared/kernel";
import type { AlreadyOwned, BuyQuantityInvalid, DoesNotFit, WishNotFound } from "../domain/errors";
import { fits, ownedToward, type WishId } from "../domain/wish";
import type { WishlistDependencies } from "./ports";

// Buying from the wishlist (design doc 26, rules 6–8): the store's purchase, then the wish goes
// once you own the copies you wanted. One transaction, so a purchase the wallet refuses leaves
// the wish where it was.

export type BuyWishInput = Readonly<{
  wishId: WishId;
  /** The printing and finish picked on the page (the best offer, or another from the menu). */
  printingId: string;
  finish: Finish;
  quantity: number;
  /** The price per copy the page showed: buying refuses if it has gone up since (rule 7). */
  expectedUnitPrice: Cents;
}>;

export type BoughtWish = Readonly<{
  receipt: SingleReceipt;
  /** True when this purchase filled the wish, and so removed it (rule 8). */
  isFulfilled: boolean;
}>;

export type BuyWishError =
  WishNotFound | AlreadyOwned | DoesNotFit | BuyQuantityInvalid | BuySingleInError;

export function makeBuyWish(dependencies: WishlistDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function buyWish(
    actor: Actor,
    input: BuyWishInput,
  ): Promise<Result<BoughtWish, BuyWishError>> {
    return unitOfWork.run<BoughtWish, BuyWishError>(async (services) => {
      const { wishes, wishCatalog } = services;
      await wishes.lock(actor.userId);
      const wish = await wishes.find(input.wishId, actor.userId);
      if (wish === null) return err({ kind: "WishNotFound" });

      const facts = await wishCatalog.printing(input.printingId);
      if (facts === null) return err({ kind: "DoesNotFit" });
      const copy = { oracleId: facts.oracleId, printingId: input.printingId, finish: input.finish };
      if (!fits(wish.target, copy)) return err({ kind: "DoesNotFit" });

      const owned = ownedToward(
        wish.target,
        await wishCatalog.owned(actor.userId, wish.target.oracleId),
      );
      const missing = wish.quantity - owned;
      if (missing <= 0) return err({ kind: "AlreadyOwned" });
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > missing) {
        return err({ kind: "BuyQuantityInvalid", max: missing });
      }

      const bought = await buySingleIn(services, {
        actor,
        line: {
          printingId: PrintingId.of(input.printingId),
          finish: input.finish,
          quantity: input.quantity,
        },
        maxUnitPrice: input.expectedUnitPrice,
        now: clock.now(),
      });
      if (!bought.ok) return bought;

      const isFulfilled = input.quantity === missing;
      if (isFulfilled) await wishes.delete(wish.id);
      return ok({ receipt: bought.value, isFulfilled });
    });
  }

  return buyWish;
}
