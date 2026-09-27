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
export function makeAccounts(dependencies: AccountsDependencies) {
  return {
    registerPlayer: makeRegisterPlayer(dependencies),
    signIn: makeSignIn(dependencies),
    signOut: makeSignOut(dependencies),
    getActor: makeGetActor(dependencies),
    changeOwnPassword: makeChangeOwnPassword(dependencies),
    createInvite: makeCreateInvite(dependencies),
    revokeInvite: makeRevokeInvite(dependencies),
    setAdmin: makeSetAdmin(dependencies),
    setSelfFunding: makeSetSelfFunding(dependencies),
    setDisabled: makeSetDisabled(dependencies),
    resetPassword: makeResetPassword(dependencies),
  };
}

export type Accounts = ReturnType<typeof makeAccounts>;
