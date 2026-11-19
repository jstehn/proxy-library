import { collectionPage } from "@/modules/collection";
import { decksFor } from "@/modules/decks";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import { wishlistAnswers } from "@/modules/wishlist";
import type { DbExecutor } from "@/shared/db";
import type { Cents, Clock, UserId } from "@/shared/kernel";
import { makeGetAccountOverview } from "./application/get-account-overview";

// The accounts module's capabilities (ADR 0026): the account overview reads the balance, the
// collection, the decks and the wishlist through those modules' public APIs.

type AccountWiringDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  wallet: Readonly<{ refreshWallet(userId: UserId): Promise<Cents> }>;
}>;

export function wireAccountCapabilities(dependencies: AccountWiringDependencies) {
  const { db, clock, wallet } = dependencies;
  return {
    getAccountOverview: makeGetAccountOverview({
      refreshBalance: (userId) => wallet.refreshWallet(userId),
      allowance: async () => {
        const settings = await currentEconomySettings(db);
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
      collectionTotals: async (userId) => {
        const page = await collectionPage(db, userId, { sections: "none", sort: "name", page: 1 });
        return {
          differentCards: page.totals.different,
          copies: page.totals.copies,
          valueCents: page.totals.valueCents,
        };
      },
      deckCount: async (userId) => (await decksFor(db, userId)).length,
      wishCount: async (userId) => (await wishlistAnswers(db, userId)).wishes.length,
    }),
  };
}
