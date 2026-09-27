import { ok, type Result } from "@/shared/kernel";
import { Password } from "../domain/credentials";
import type { InvalidCredentials, PasswordInvalid, PlayerNotFound } from "../domain/errors";
import type { Actor } from "../domain/player";
import { findPlayer } from "./find-player";
import type { AccountsDependencies } from "./ports";

export type ChangeOwnPasswordInput = { currentPassword: string; newPassword: string };
export type ChangeOwnPasswordError = PasswordInvalid | InvalidCredentials | PlayerNotFound;

/** A player changes their own password. Also clears "must change password" after a reset. */
export function makeChangeOwnPassword(dependencies: AccountsDependencies) {
  const { unitOfWork, identity } = dependencies;

  async function changeOwnPassword(
    actor: Actor,
    input: ChangeOwnPasswordInput,
    requestHeaders: Headers,
  ): Promise<Result<void, ChangeOwnPasswordError>> {
    const newPassword = Password.parse(input.newPassword);
    if (!newPassword.ok) return newPassword;

    const changed = await identity.changePassword(
      { currentPassword: input.currentPassword, newPassword: newPassword.value },
      requestHeaders,
    );
    if (!changed.ok) return changed;

    return unitOfWork.run<void, ChangeOwnPasswordError>(async ({ players }) => {
      const player = await findPlayer(players, actor.userId);
      if (!player.ok) return player;
      if (player.value.mustChangePassword) {
        await players.update({ ...player.value, mustChangePassword: false });
      }
      return ok();
    });
  }

  return changeOwnPassword;
}
