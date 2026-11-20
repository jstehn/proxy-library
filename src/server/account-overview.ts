import { collectionQueries } from "@/modules/collection";
import { decksFor } from "@/modules/decks";
import { nextPayday, walletQueries } from "@/modules/wallet";
import { wishlistQueries } from "@/modules/wishlist";
import type { AccountOverviewReaders } from "@/modules/accounts/wiring";
import type { DbExecutor } from "@/shared/db";
import type { Clock } from "@/shared/kernel";

// The account overview reads other modules (wallet, collection, decks, wishlist), so this
// composition-root file builds those readers and hands them to the accounts wiring as arguments.
// That keeps `accounts` free of imports of the modules that already import it (P29).
export function accountOverviewReaders(
  dependencies: Readonly<{ db: DbExecutor; clock: Clock }>,
): AccountOverviewReaders {
  const { db, clock } = dependencies;
  return {
    allowance: async () => {
      const settings = await walletQueries.economySettings(db);
      if (settings.allowance <= 0) return null;
      return {
        amountCents: settings.allowance,
        everyDays: settings.allowancePeriodDays,
        next: nextPayday(
          { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
          clock.now(),
        ),
      };
    },
    collectionTotals: async (actor) => {
      const page = await collectionQueries.page(db, actor, {
        sections: "none",
        sort: "name",
        page: 1,
      });
      return {
        differentCards: page.totals.different,
        copies: page.totals.copies,
        valueCents: page.totals.valueCents,
      };
    },
    deckCount: async (actor) => (await decksFor(db, actor.userId)).length,
    wishCount: async (actor) => (await wishlistQueries.answers(db, actor)).wishes.length,
  };
}
