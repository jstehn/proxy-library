import { makeGetAccountOverview } from "@/modules/accounts";
import { collectionPage } from "@/modules/collection";
import { decksFor, makeListDecks } from "@/modules/decks";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import { wishlistAnswers } from "@/modules/wishlist";
import type { DbExecutor } from "@/shared/db";
import type { Cents, Clock, UserId } from "@/shared/kernel";

// The capabilities (ADR 0026): typed functions that the adapters (server actions, LLM tool
// bindings, routes, worker commands) call. Each is built here from its module's factory, with the
// readers it needs from other modules passed in as ports. A new capability gets one line below.

type CapabilityDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  wallet: Readonly<{ refreshWallet(userId: UserId): Promise<Cents> }>;
}>;

export function buildCapabilities(dependencies: CapabilityDependencies) {
  const { db, clock, wallet } = dependencies;

  return {
    listDecks: makeListDecks({
      decksFor: (userId) => decksFor(db, userId),
    }),
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

export type Capabilities = ReturnType<typeof buildCapabilities>;
