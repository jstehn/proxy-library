import type { UserId } from "@/shared/kernel";
import type { DisplayName, Username } from "./credentials";

/** A person with an account. Every user is a player; some players are also admins. */
export type Player = Readonly<{
  userId: UserId;
  username: Username;
  displayName: DisplayName;
  isAdmin: boolean;
  canSelfFund: boolean;
  disabledAt: Date | null; // null means active
  mustChangePassword: boolean; // true after an admin reset
  joinedAt: Date;
}>;

// The two brands exist only in the type system and are not exported, so no other file can write
// an object that type-checks as an `Actor` (design doc 67, section 6). The one place that makes
// them is this file: `toActor` for a signed-in player, `asAdmin` for an admin.
declare const actorBrand: unique symbol;
declare const adminBrand: unique symbol;

/** The fields of an actor, without the brand. */
export type ActorFields = Readonly<{
  userId: UserId;
  username: Username;
  displayName: DisplayName;
  isAdmin: boolean;
  canSelfFund: boolean;
  mustChangePassword: boolean;
}>;

/**
 * The signed-in player performing an action. Only active players can be actors, and only
 * `toActor` makes one (lint forbids `as Actor` elsewhere, outside tests).
 */
export type Actor = ActorFields & { readonly [actorBrand]: true };

/** An actor the admin guard has checked. Admin reads and admin capabilities take this type. */
export type AdminActor = Actor & { readonly [adminBrand]: true };

export function newPlayer(input: {
  userId: UserId;
  username: Username;
  displayName: DisplayName;
  isAdmin: boolean;
  joinedAt: Date;
}): Player {
  return {
    ...input,
    canSelfFund: false,
    disabledAt: null,
    mustChangePassword: false,
  };
}

export function isActive(player: Player): boolean {
  return player.disabledAt === null;
}

export function toActor(player: Player): Actor {
  const fields: ActorFields = {
    userId: player.userId,
    username: player.username,
    displayName: player.displayName,
    isAdmin: player.isAdmin,
    canSelfFund: player.canSelfFund,
    mustChangePassword: player.mustChangePassword,
  };
  return fields as Actor;
}

/** The actor as an `AdminActor`, or null when the player isn't an admin. */
export function asAdmin(actor: Actor): AdminActor | null {
  return actor.isAdmin ? (actor as AdminActor) : null;
}

/** A method that takes the `Actor` first, as one that takes the `AdminActor` instead. */
export type ForAdmin<Method> = Method extends (actor: Actor, ...rest: infer Rest) => infer Returned
  ? (admin: AdminActor, ...rest: Rest) => Returned
  : never;

/** Some of a service's admin-only methods: like `pick`, but each takes the `AdminActor` first. */
export function pickForAdmin<Source extends object, Key extends keyof Source>(
  source: Source,
  ...keys: readonly Key[]
): { [K in Key]: ForAdmin<Source[K]> } {
  const picked: Partial<Record<Key, unknown>> = {};
  for (const key of keys) picked[key] = source[key];
  return picked as { [K in Key]: ForAdmin<Source[K]> };
}
