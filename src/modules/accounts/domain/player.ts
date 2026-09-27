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

/** The signed-in player performing an action. Only active players can be actors. */
export type Actor = Readonly<{
  userId: UserId;
  username: Username;
  displayName: DisplayName;
  isAdmin: boolean;
  canSelfFund: boolean;
  mustChangePassword: boolean;
}>;

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
  return {
    userId: player.userId,
    username: player.username,
    displayName: player.displayName,
    isAdmin: player.isAdmin,
    canSelfFund: player.canSelfFund,
    mustChangePassword: player.mustChangePassword,
  };
}
