import { asAdmin } from "../domain/player";
import { makeChangeOwnPassword } from "./change-own-password";
import { makeCreateInvite, makeRevokeInvite } from "./manage-invites";
import {
  makeResetPassword,
  makeSetAdmin,
  makeSetDisabled,
  makeSetSelfFunding,
} from "./manage-players";
import type { AccountsDependencies } from "./ports";
import { makeRegisterPlayer } from "./register-player";
import { makeGetActor, makeSignOut } from "./session";
import { makeSignIn } from "./sign-in";

/**
 * Builds every accounts use case from one set of dependencies.
 * The composition root calls this once; tests call it with fakes.
 */
import {
  makeActorFromToken,
  makeCreateAccessToken,
  makeRevokeAccessToken,
} from "./connectors/access-tokens";
import {
  makeApproveAuthorization,
  makeCheckAuthorizationRequest,
  makeDenyAuthorization,
  makeCreateOAuthClient,
  makeExchangeAuthorizationCode,
  makeRegisterOAuthClient,
} from "./connectors/oauth";
import { makeCreateManualOAuthClient, makeDeleteOAuthClient } from "./connectors/oauth-clients";
import {
  makeHandleExternalCallback,
  makeSetPlayerEmail,
  makeStartExternalLink,
  makeStartExternalSignIn,
  makeUnlinkExternal,
} from "./external-sign-in";

export function makeAccounts(dependencies: AccountsDependencies) {
  const checkAuthorizationRequest = makeCheckAuthorizationRequest(dependencies);
  const createOAuthClient = makeCreateOAuthClient(dependencies);
  return {
    registerPlayer: makeRegisterPlayer(dependencies),
    signIn: makeSignIn(dependencies),
    signOut: makeSignOut(dependencies),
    getActor: makeGetActor(dependencies),
    /** Only `src/server/session.ts` calls this: the one door to an `AdminActor`. */
    asAdmin,
    changeOwnPassword: makeChangeOwnPassword(dependencies),
    createInvite: makeCreateInvite(dependencies),
    revokeInvite: makeRevokeInvite(dependencies),
    setAdmin: makeSetAdmin(dependencies),
    setSelfFunding: makeSetSelfFunding(dependencies),
    setDisabled: makeSetDisabled(dependencies),
    resetPassword: makeResetPassword(dependencies),
    createAccessToken: makeCreateAccessToken(dependencies),
    revokeAccessToken: makeRevokeAccessToken(dependencies),
    actorFromToken: makeActorFromToken(dependencies),
    startExternalSignIn: makeStartExternalSignIn(dependencies),
    startExternalLink: makeStartExternalLink(dependencies),
    unlinkExternal: makeUnlinkExternal(dependencies),
    handleExternalCallback: makeHandleExternalCallback(dependencies),
    setPlayerEmail: makeSetPlayerEmail(dependencies),
    registerOAuthClient: makeRegisterOAuthClient(createOAuthClient),
    createManualOAuthClient: makeCreateManualOAuthClient(createOAuthClient),
    deleteOAuthClient: makeDeleteOAuthClient(dependencies),
    checkAuthorizationRequest,
    approveAuthorization: makeApproveAuthorization(dependencies, checkAuthorizationRequest),
    denyAuthorization: makeDenyAuthorization(checkAuthorizationRequest),
    exchangeAuthorizationCode: makeExchangeAuthorizationCode(dependencies),
  };
}

export type Accounts = ReturnType<typeof makeAccounts>;
