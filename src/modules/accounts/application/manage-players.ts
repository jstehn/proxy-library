import { ok, type Result, type UserId } from "@/shared/kernel";
import type { Password } from "../domain/credentials";
import type { CannotDisableSelf, Forbidden, LastAdmin, PlayerNotFound } from "../domain/errors";
import type { Actor, Player } from "../domain/player";
import { checkAdminChange, checkDisableChange, requireAdmin } from "../domain/rules";
import { findPlayer } from "./find-player";
import type { AccountsDependencies } from "./ports";

// Admin actions on other players. Every one starts with requireAdmin (rule 9), and the
// ones that could remove the last admin take the accounts lock first (rule 6).

export type SetAdminError = Forbidden | PlayerNotFound | LastAdmin;
export type SetSelfFundingError = Forbidden | PlayerNotFound;
export type SetDisabledError = Forbidden | PlayerNotFound | CannotDisableSelf | LastAdmin;
export type ResetPasswordError = Forbidden | PlayerNotFound;

/** Promote a player to admin, or demote an admin. */
export function makeSetAdmin(dependencies: AccountsDependencies) {
  const { unitOfWork } = dependencies;

  async function setAdmin(
    actor: Actor,
    input: { userId: UserId; isAdmin: boolean },
  ): Promise<Result<Player, SetAdminError>> {
    const allowed = requireAdmin(actor);
    if (!allowed.ok) return allowed;

    return unitOfWork.run<Player, SetAdminError>(async ({ players }) => {
      await players.lockAccounts();
      const target = await findPlayer(players, input.userId);
      if (!target.ok) return target;

      const change = checkAdminChange({
        target: target.value,
        makeAdmin: input.isAdmin,
        activeAdminCount: await players.countActiveAdmins(),
      });
      if (!change.ok) return change;

      const updated: Player = { ...target.value, isAdmin: input.isAdmin };
      await players.update(updated);
      return ok(updated);
    });
  }

  return setAdmin;
}

/** Allow or stop a player adding money to their own wallet. */
export function makeSetSelfFunding(dependencies: AccountsDependencies) {
  const { unitOfWork } = dependencies;

  async function setSelfFunding(
    actor: Actor,
    input: { userId: UserId; allowed: boolean },
  ): Promise<Result<Player, SetSelfFundingError>> {
    const allowed = requireAdmin(actor);
    if (!allowed.ok) return allowed;

    return unitOfWork.run<Player, SetSelfFundingError>(async ({ players }) => {
      const target = await findPlayer(players, input.userId);
      if (!target.ok) return target;

      const updated: Player = { ...target.value, canSelfFund: input.allowed };
      await players.update(updated);
      return ok(updated);
    });
  }

  return setSelfFunding;
}

/** Disable a player (they can't sign in; nothing is deleted), or enable them again. */
export function makeSetDisabled(dependencies: AccountsDependencies) {
  const { unitOfWork, identity, clock } = dependencies;

  async function setDisabled(
    actor: Actor,
    input: { userId: UserId; disabled: boolean },
  ): Promise<Result<Player, SetDisabledError>> {
    const allowed = requireAdmin(actor);
    if (!allowed.ok) return allowed;

    const result = await unitOfWork.run<Player, SetDisabledError>(async ({ players }) => {
      await players.lockAccounts();
      const target = await findPlayer(players, input.userId);
      if (!target.ok) return target;

      const change = checkDisableChange({
        actor,
        target: target.value,
        disable: input.disabled,
        activeAdminCount: await players.countActiveAdmins(),
      });
      if (!change.ok) return change;

      const updated: Player = {
        ...target.value,
        disabledAt: input.disabled ? clock.now() : null,
      };
      await players.update(updated);
      return ok(updated);
    });

    // Rule 8: disabling someone signs them out everywhere, straight away.
    if (result.ok && input.disabled) await identity.endAllSessions(input.userId);
    return result;
  }

  return setDisabled;
}

/**
 * Give a player a new temporary password. They must change it at their next sign-in.
 * The temporary password is returned once, for the admin to pass on.
 */
export function makeResetPassword(dependencies: AccountsDependencies) {
  const { unitOfWork, identity, secrets } = dependencies;

  async function resetPassword(
    actor: Actor,
    input: { userId: UserId },
  ): Promise<Result<{ temporaryPassword: Password }, ResetPasswordError>> {
    const allowed = requireAdmin(actor);
    if (!allowed.ok) return allowed;

    const temporaryPassword = secrets.temporaryPassword();

    const result = await unitOfWork.run<Player, ResetPasswordError>(async ({ players }) => {
      const target = await findPlayer(players, input.userId);
      if (!target.ok) return target;

      const updated: Player = { ...target.value, mustChangePassword: true };
      await players.update(updated);
      return ok(updated);
    });
    if (!result.ok) return result;

    await identity.setPassword(input.userId, temporaryPassword);
    await identity.endAllSessions(input.userId);
    return ok({ temporaryPassword });
  }

  return resetPassword;
}
