import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { AccessTokenId, withRead, type AccessToken } from "../domain/access-token";
import type { Actor } from "../domain/player";
import { accessTokens } from "../infrastructure/schema";

/** A player's live access tokens, newest first, for their Account page (design doc 28). */
export async function listAccessTokens(db: DbExecutor, actor: Actor): Promise<AccessToken[]> {
  const userId = actor.userId;
  const rows = await db
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, userId), isNull(accessTokens.revokedAt)))
    .orderBy(desc(accessTokens.createdAt), desc(accessTokens.id));
  return rows.map((row) => ({
    id: AccessTokenId.of(row.id),
    userId,
    name: row.name,
    prefix: row.prefix,
    scopes: withRead(row.scopes),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  }));
}
