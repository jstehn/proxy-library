import { collectionQueries } from "@/modules/collection";
import { decksFor } from "@/modules/decks";
import { nextPayday, walletQueries } from "@/modules/wallet";
import { wishlistQueries } from "@/modules/wishlist";
import type { DbExecutor } from "@/shared/db";
import { pick, type Cents, type Clock } from "@/shared/kernel";
import { pickForAdmin, type Actor } from "./domain/player";
import type { Accounts } from "./application/make-accounts";
import { makeGetAccountOverview } from "./application/get-account-overview";

// The accounts module's capabilities (ADR 0026): the account overview reads the balance, the
// collection, the decks and the wishlist through those modules' public APIs.

type AccountWiringDependencies = Readonly<{
  accounts: Accounts;
  db: DbExecutor;
  clock: Clock;
  wallet: Readonly<{ refreshWallet(actor: Actor): Promise<Cents> }>;
}>;

export function wireAccountCapabilities(dependencies: AccountWiringDependencies) {
  const { accounts, db, clock, wallet } = dependencies;
  return {
    // `signIn`, `registerPlayer` and `signOut` are for visitors, so they take no actor.
    accounts: {
      ...pick(
        accounts,
        "signIn",
        "signOut",
        "registerPlayer",
        "actorFromToken",
        "changeOwnPassword",
        "createAccessToken",
        "revokeAccessToken",
        "checkAuthorizationRequest",
        "approveAuthorization",
        "denyAuthorization",
      ),
      ...pickForAdmin(
        accounts,
        "createInvite",
        "revokeInvite",
        "setAdmin",
        "setDisabled",
        "setSelfFunding",
        "resetPassword",
      ),
    },
    getAccountOverview: makeGetAccountOverview({
      refreshBalance: (actor) => wallet.refreshWallet(actor),
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
    }),
  };
}
