import type { Actor } from "@/modules/accounts";
import { nextPayday, walletQueries } from "@/modules/wallet";
import type { DbExecutor } from "@/shared/db";
import type { Cents, Clock } from "@/shared/kernel";
import { makeAddWishes, makeRemoveWishes, makeWishlistView } from "./application/wishlist-tools";
import type { Wishlist } from "./application/make-wishlist";
import { WishId } from "./domain/wish";
import { answers } from "./queries/wishlist";

// The wishlist's capabilities (ADR 0026). `findCard` comes from the decks module's card lookup,
// which the composition root passes in.

type WishlistWiringDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  wallet: Readonly<{ refreshWallet(actor: Actor): Promise<Cents> }>;
  wishlist: Pick<Wishlist, "addWish" | "removeWish">;
  findCard: Parameters<typeof makeAddWishes>[0]["findCard"];
}>;

export function wireWishlistCapabilities(dependencies: WishlistWiringDependencies) {
  const { db, clock, wallet, wishlist, findCard } = dependencies;
  return {
    wishlistView: makeWishlistView({
      answers: (actor) => answers(db, actor),
      outlook: async (actor) => {
        const [balance, settings] = await Promise.all([
          wallet.refreshWallet(actor),
          walletQueries.economySettings(db),
        ]);
        return {
          balance,
          allowance: settings.allowance,
          allowancePeriodDays: settings.allowancePeriodDays,
          nextPayday: nextPayday(
            { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
            clock.now(),
          ),
        };
      },
    }),
    addWishes: makeAddWishes({
      findCard,
      addWish: (actor, input) => wishlist.addWish(actor, input),
    }),
    removeWishes: makeRemoveWishes(
      { removeWish: (actor, wishId) => wishlist.removeWish(actor, wishId) },
      (value) => WishId.of(value),
    ),
  };
}
