import { asc, count, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "@/shared/db";
import { inviteStatus, type InviteStatus } from "../domain/invite";
import { authUsers, invites, players } from "../infrastructure/schema";

// Read models for the admin screens (ADR 0006): one query each, plain objects out.

export type PlayerListItem = Readonly<{
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  canSelfFund: boolean;
  isDisabled: boolean;
  joinedAt: string; // ISO date, so it can be passed to client components
}>;

export async function listPlayers(db: DbExecutor): Promise<PlayerListItem[]> {
  const rows = await db
    .select({
      userId: players.userId,
      username: authUsers.username,
      displayName: authUsers.name,
      isAdmin: players.isAdmin,
      canSelfFund: players.canSelfFund,
      disabledAt: players.disabledAt,
      joinedAt: players.createdAt,
    })
    .from(players)
    .innerJoin(authUsers, eq(authUsers.id, players.userId))
    .orderBy(asc(authUsers.username));

  return rows.map((row) => ({
    userId: row.userId,
    username: row.username ?? "",
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    canSelfFund: row.canSelfFund,
    isDisabled: row.disabledAt !== null,
    joinedAt: row.joinedAt.toISOString(),
  }));
}

export type InviteListItem = Readonly<{
  code: string;
  status: InviteStatus;
  createdBy: string;
  expiresAt: string;
  usedBy: string | null;
}>;

export async function listInvites(db: DbExecutor, now: Date): Promise<InviteListItem[]> {
  const creator = alias(authUsers, "creator");
  const user = alias(authUsers, "invitee");

  const rows = await db
    .select({
      invite: invites,
      createdBy: creator.username,
      usedBy: user.username,
    })
    .from(invites)
    .innerJoin(creator, eq(creator.id, invites.createdBy))
    .leftJoin(user, eq(user.id, invites.usedBy))
    .orderBy(desc(invites.createdAt));

  return rows.map((row) => ({
    code: row.invite.code,
    // Status depends on the current time, so it is worked out here rather than stored.
    status: inviteStatus(row.invite, now),
    createdBy: row.createdBy ?? "",
    expiresAt: row.invite.expiresAt.toISOString(),
    usedBy: row.usedBy,
  }));
}

/** Whether anyone has registered yet (the register page hides the invite field if not). */
export async function hasAnyPlayers(db: DbExecutor): Promise<boolean> {
  const [row] = await db.select({ total: count() }).from(players);
  return row.total > 0;
}
