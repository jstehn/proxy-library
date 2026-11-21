import { pick, type Cents } from "@/shared/kernel";
import { pickForAdmin, type Actor } from "./domain/player";
import type { Accounts } from "./application/make-accounts";
import {
  makeGetAccountOverview,
  type GetAccountOverviewDependencies,
} from "./application/get-account-overview";

// The accounts module's capabilities (ADR 0026). The account overview needs readers from other
// modules; the composition root (`src/server/composition/account-overview.ts`) passes them in, so accounts
// imports none of them.

/** The overview's readers that belong to other modules (all but the balance). */
export type AccountOverviewReaders = Omit<GetAccountOverviewDependencies, "refreshBalance">;

type AccountWiringDependencies = Readonly<{
  accounts: Accounts;
  readers: AccountOverviewReaders;
  wallet: Readonly<{ refreshWallet(actor: Actor): Promise<Cents> }>;
}>;

export function wireAccountCapabilities(dependencies: AccountWiringDependencies) {
  const { accounts, readers, wallet } = dependencies;
  return {
    // `signIn`, `registerPlayer` and `signOut` are for visitors, so they take no actor.
    accounts: {
      ...pick(
        accounts,
        "signIn",
        "signOut",
        "registerPlayer",
        "startExternalSignIn",
        "handleExternalCallback",
        "startExternalLink",
        "unlinkExternal",
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
        "setPlayerEmail",
        "createManualOAuthClient",
        "deleteOAuthClient",
      ),
    },
    getAccountOverview: makeGetAccountOverview({
      refreshBalance: (actor) => wallet.refreshWallet(actor),
      ...readers,
    }),
  };
}
