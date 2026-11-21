import { asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "@/shared/db";
import type { AdminActor } from "../domain/player";
import { inviteStatus, type InviteStatus } from "../domain/invite";
import { EXTERNAL_PROVIDER_ID, hasRealEmail } from "../domain/external-sign-in";
import {
  accessTokens,
  authAccounts,
  authUsers,
  invites,
  oauthClients,
  players,
} from "../infrastructure/schema";

// Read models for the admin screens (ADR 0006): one query each, plain objects out.

export type PlayerListItem = Readonly<{
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  canSelfFund: boolean;
  isDisabled: boolean;
  /** The real email an admin set (verified on their say-so), or null for the placeholder. */
  email: string | null;
  /** Whether the player has linked their Authentik account (design doc 69). */
  authentikLinked: boolean;
  joinedAt: string; // ISO date, so it can be passed to client components
}>;

/** Every player, for the admin page (kind A: the `AdminActor` is the access rule). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the AdminActor parameter is the access rule
export async function listPlayers(db: DbExecutor, admin: AdminActor): Promise<PlayerListItem[]> {
  const rows = await db
    .select({
      userId: players.userId,
      username: authUsers.username,
      displayName: authUsers.name,
      isAdmin: players.isAdmin,
      canSelfFund: players.canSelfFund,
      disabledAt: players.disabledAt,
      email: authUsers.email,
      authentikLinked: sql<boolean>`exists (
        select 1 from ${authAccounts}
         where ${authAccounts.userId} = ${players.userId}
           and ${authAccounts.providerId} = ${EXTERNAL_PROVIDER_ID}
      )`,
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
    email: hasRealEmail(row.email) ? row.email : null,
    authentikLinked: row.authentikLinked,
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

/** Every invite, for the admin page (kind A). */
export async function listInvites(
  db: DbExecutor,
  admin: AdminActor,
  now: Date,
): Promise<InviteListItem[]> {
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

export type OAuthClientListItem = Readonly<{
  clientId: string;
  name: string;
  redirectUris: readonly string[];
  /** `none` for a public client; otherwise it holds a secret. */
  authMethod: string;
  /** The admin who made it by hand, or null when the app registered itself. */
  createdBy: string | null;
  createdAt: string;
  liveTokens: number;
}>;

/** Every OAuth client, newest first, with how many live tokens each has made (kind A). */
export async function listOAuthClients(
  db: DbExecutor,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the AdminActor parameter is the access rule
  admin: AdminActor,
): Promise<OAuthClientListItem[]> {
  const rows = await db
    .select({
      client: oauthClients,
      createdBy: authUsers.username,
      liveTokens: sql<number>`(
        select count(*)::int from ${accessTokens}
         where ${accessTokens.oauthClientId} = ${oauthClients.clientId}
           and ${accessTokens.revokedAt} is null
      )`,
    })
    .from(oauthClients)
    .leftJoin(authUsers, eq(authUsers.id, oauthClients.createdBy))
    .orderBy(desc(oauthClients.createdAt))
    .limit(200);

  return rows.map((row) => ({
    clientId: row.client.clientId,
    name: row.client.name,
    redirectUris: row.client.redirectUris,
    authMethod: row.client.authMethod,
    createdBy: row.createdBy,
    createdAt: row.client.createdAt.toISOString(),
    liveTokens: row.liveTokens,
  }));
}
