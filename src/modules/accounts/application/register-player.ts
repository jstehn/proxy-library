import { err, ok, type Result, type UserId } from "@/shared/kernel";
import { DisplayName, Password, Username } from "../domain/credentials";
import type {
  DisplayNameInvalid,
  InviteNotFound,
  InviteNotOpen,
  InviteRequired,
  PasswordInvalid,
  UsernameInvalid,
  UsernameTaken,
} from "../domain/errors";
import { InviteCode, markUsed, requireOpen, type Invite } from "../domain/invite";
import { newPlayer, type Player } from "../domain/player";
import type { AccountsDependencies } from "./ports";

export type RegisterPlayerInput = {
  username: string;
  displayName: string;
  password: string;
  inviteCode: string; // may be empty when registering the very first player
};

export type RegisterPlayerError =
  | UsernameInvalid
  | DisplayNameInvalid
  | PasswordInvalid
  | InviteRequired
  | InviteNotFound
  | InviteNotOpen
  | UsernameTaken;

/**
 * Registers a new player (design doc 02, section 5).
 * The first player ever needs no invite and becomes an admin; everyone after needs an open invite.
 */
export function makeRegisterPlayer(dependencies: AccountsDependencies) {
  const { unitOfWork, identity, clock } = dependencies;

  async function registerPlayer(
    input: RegisterPlayerInput,
  ): Promise<Result<Player, RegisterPlayerError>> {
    const username = Username.parse(input.username);
    if (!username.ok) return username;
    const displayName = DisplayName.parse(input.displayName);
    if (!displayName.ok) return displayName;
    const password = Password.parse(input.password);
    if (!password.ok) return password;

    // Better Auth saves credentials on its own database connection, outside our transaction.
    // If anything fails after that, we delete them again. This remembers what to delete.
    const created: { userId: UserId | null } = { userId: null };

    try {
      const result = await unitOfWork.run<Player, RegisterPlayerError>(
        async ({ players, invites }) => {
          await players.lockAccounts();
          const now = clock.now();
          const isFirstPlayer = (await players.countPlayers()) === 0;

          // Every player after the first needs an open invite. Check it *before* creating
          // credentials, so a bad invite never creates anything.
          let invite: Invite | null = null;
          if (!isFirstPlayer) {
            if (input.inviteCode.trim() === "") return err({ kind: "InviteRequired" });
            const code = InviteCode.parse(input.inviteCode);
            invite = code === null ? null : await invites.findByCode(code);
            if (invite === null) return err({ kind: "InviteNotFound" });
            const open = requireOpen(invite, now);
            if (!open.ok) return open;
          }

          const userId = await identity.createUser({
            username: username.value,
            displayName: displayName.value,
            password: password.value,
          });
          if (!userId.ok) return userId;
          created.userId = userId.value;

          const player = newPlayer({
            userId: userId.value,
            username: username.value,
            displayName: displayName.value,
            isAdmin: isFirstPlayer,
            joinedAt: now,
          });
          await players.insert(player);

          // The invite records who used it, so the player row must exist first.
          if (invite !== null) {
            const usedInvite = markUsed(invite, userId.value, now);
            if (!usedInvite.ok) return usedInvite;
            await invites.update(usedInvite.value);
          }

          return ok(player);
        },
      );

      if (!result.ok) await undoCreatedUser();
      return result;
    } catch (error) {
      await undoCreatedUser();
      throw error;
    }

    async function undoCreatedUser() {
      if (created.userId !== null) await identity.deleteUser(created.userId);
    }
  }

  return registerPlayer;
}
