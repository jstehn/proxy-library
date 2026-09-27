import { err, ok, type Result } from "@/shared/kernel";
import type { CannotDisableSelf, Forbidden, LastAdmin } from "./errors";
import { isActive, type Actor, type Player } from "./player";

// Permission rules as plain functions: given the facts, answer yes (ok) or no (err).
// They never load anything themselves, so they are trivial to test.

/** Rule 9: only admins may manage players and invites. */
export function requireAdmin(actor: Actor): Result<void, Forbidden> {
  return actor.isAdmin ? ok() : err({ kind: "Forbidden" });
}

/**
 * Rule 6: there must always be at least one active admin.
 * `activeAdminCount` is the number of active admins *before* the change.
 */
export function checkAdminChange(input: {
  target: Player;
  makeAdmin: boolean;
  activeAdminCount: number;
}): Result<void, LastAdmin> {
  const { target, makeAdmin, activeAdminCount } = input;
  const removesAnActiveAdmin = !makeAdmin && target.isAdmin && isActive(target);
  if (removesAnActiveAdmin && activeAdminCount <= 1) return err({ kind: "LastAdmin" });
  return ok();
}

/** Rules 6 and 7: you can't disable yourself, or the last active admin. */
export function checkDisableChange(input: {
  actor: Actor;
  target: Player;
  disable: boolean;
  activeAdminCount: number;
}): Result<void, CannotDisableSelf | LastAdmin> {
  const { actor, target, disable, activeAdminCount } = input;
  if (!disable) return ok();
  if (target.userId === actor.userId) return err({ kind: "CannotDisableSelf" });
  const removesAnActiveAdmin = target.isAdmin && isActive(target);
  if (removesAnActiveAdmin && activeAdminCount <= 1) return err({ kind: "LastAdmin" });
  return ok();
}
