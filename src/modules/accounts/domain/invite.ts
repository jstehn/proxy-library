import { err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type { InviteDurationInvalid, InviteNotOpen } from "./errors";

/** A one-time registration code, e.g. "K7QM-2XPA-9TRD". */
export type InviteCode = Brand<string, "InviteCode">;

export type Invite = Readonly<{
  code: InviteCode;
  createdBy: UserId;
  createdAt: Date;
  expiresAt: Date;
  usedBy: UserId | null;
  usedAt: Date | null;
  revokedAt: Date | null;
}>;

/** Worked out from an invite and the current time; never stored. */
export type InviteStatus = "open" | "used" | "expired" | "revoked";

// Crockford base32: digits and capitals without I, L, O and U, so codes are easy to read
// aloud and hard to mistype.
export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const INVITE_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export const INVITE_MIN_DAYS = 1;
export const INVITE_MAX_DAYS = 30;
export const INVITE_DEFAULT_DAYS = 7;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export const InviteCode = {
  /** Accepts what a person types: any case, spaces around it. Returns null if it can't be a code. */
  parse(raw: string): InviteCode | null {
    const code = raw.trim().toUpperCase();
    return INVITE_CODE_PATTERN.test(code) ? (code as InviteCode) : null;
  },
};

/** Only needs the three dates, so read models can pass a plain database row. */
export function inviteStatus(
  invite: Pick<Invite, "usedAt" | "revokedAt" | "expiresAt">,
  now: Date,
): InviteStatus {
  if (invite.usedAt !== null) return "used";
  if (invite.revokedAt !== null) return "revoked";
  if (now.getTime() >= invite.expiresAt.getTime()) return "expired";
  return "open";
}

export function newInvite(input: {
  code: InviteCode;
  createdBy: UserId;
  now: Date;
  validForDays: number;
}): Result<Invite, InviteDurationInvalid> {
  const { code, createdBy, now, validForDays } = input;
  const isValidDuration =
    Number.isInteger(validForDays) &&
    validForDays >= INVITE_MIN_DAYS &&
    validForDays <= INVITE_MAX_DAYS;
  if (!isValidDuration) return err({ kind: "InviteDurationInvalid" });

  return ok({
    code,
    createdBy,
    createdAt: now,
    expiresAt: new Date(now.getTime() + validForDays * DAY_IN_MILLISECONDS),
    usedBy: null,
    usedAt: null,
    revokedAt: null,
  });
}

/** Checks an invite can still be used. */
export function requireOpen(invite: Invite, now: Date): Result<Invite, InviteNotOpen> {
  const status = inviteStatus(invite, now);
  if (status === "open") return ok(invite);
  return err({ kind: "InviteNotOpen", status });
}

export function markUsed(invite: Invite, usedBy: UserId, now: Date): Result<Invite, InviteNotOpen> {
  const open = requireOpen(invite, now);
  if (!open.ok) return open;
  return ok({ ...invite, usedBy, usedAt: now });
}

export function markRevoked(invite: Invite, now: Date): Result<Invite, InviteNotOpen> {
  const open = requireOpen(invite, now);
  if (!open.ok) return open;
  return ok({ ...invite, revokedAt: now });
}
