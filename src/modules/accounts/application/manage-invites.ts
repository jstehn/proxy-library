import { err, ok, type Result } from "@/shared/kernel";
import type {
  Forbidden,
  InviteDurationInvalid,
  InviteNotFound,
  InviteNotOpen,
} from "../domain/errors";
import { InviteCode, markRevoked, newInvite, type Invite } from "../domain/invite";
import type { Actor } from "../domain/player";
import { requireAdmin } from "../domain/rules";
import type { AccountsDependencies } from "./ports";

export type CreateInviteError = Forbidden | InviteDurationInvalid;
export type RevokeInviteError = Forbidden | InviteNotFound | InviteNotOpen;

/** An admin creates a one-time invite code to share with a new player. */
export function makeCreateInvite(dependencies: AccountsDependencies) {
  const { unitOfWork, secrets, clock } = dependencies;

  async function createInvite(
    actor: Actor,
    input: { validForDays: number },
  ): Promise<Result<Invite, CreateInviteError>> {
    const allowed = requireAdmin(actor);
    if (!allowed.ok) return allowed;

    const invite = newInvite({
      code: secrets.inviteCode(),
      createdBy: actor.userId,
      now: clock.now(),
      validForDays: input.validForDays,
    });
    if (!invite.ok) return invite;

    return unitOfWork.run<Invite, CreateInviteError>(async ({ invites }) => {
      await invites.insert(invite.value);
      return ok(invite.value);
    });
  }

  return createInvite;
}

/** An admin cancels an invite that hasn't been used yet. */
export function makeRevokeInvite(dependencies: AccountsDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function revokeInvite(
    actor: Actor,
    input: { code: string },
  ): Promise<Result<void, RevokeInviteError>> {
    const allowed = requireAdmin(actor);
    if (!allowed.ok) return allowed;

    return unitOfWork.run<void, RevokeInviteError>(async ({ invites }) => {
      const code = InviteCode.parse(input.code);
      const invite = code === null ? null : await invites.findByCode(code);
      if (invite === null) return err({ kind: "InviteNotFound" });

      const revoked = markRevoked(invite, clock.now());
      if (!revoked.ok) return revoked;
      await invites.update(revoked.value);
      return ok();
    });
  }

  return revokeInvite;
}
