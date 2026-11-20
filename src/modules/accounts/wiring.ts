import { collectionPage } from "@/modules/collection";
import { decksFor } from "@/modules/decks";
import { nextPayday, walletQueries } from "@/modules/wallet";
import { wishlistAnswersOf } from "@/modules/wishlist";
import { withDb, type DbExecutor } from "@/shared/db";
import type { Cents, Clock, UserId } from "@/shared/kernel";
import { listAccessTokens } from "./queries/access-tokens";
import { hasAnyPlayers, listInvites, listPlayers } from "./queries/admin";
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
    accountReads: {
      hasAnyPlayers: withDb(db, hasAnyPlayers),
      listAccessTokens: withDb(db, listAccessTokens),
      listInvites: withDb(db, listInvites),
      listPlayers: withDb(db, listPlayers),
    },
    getAccountOverview: makeGetAccountOverview({
      refreshBalance: (userId) => wallet.refreshWallet(userId),
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
      collectionTotals: async (userId) => {
        const page = await collectionPage(db, userId, { sections: "none", sort: "name", page: 1 });
        return {
          differentCards: page.totals.different,
          copies: page.totals.copies,
          valueCents: page.totals.valueCents,
        };
      },
      deckCount: async (userId) => (await decksFor(db, userId)).length,
      wishCount: async (userId) => (await wishlistAnswersOf(db, userId)).wishes.length,
    }),
  };
}
