import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { EXTERNAL_PROVIDER_ID, hasRealEmail } from "../domain/external-sign-in";
import type { Actor } from "../domain/player";
import { authAccounts, authUsers } from "../infrastructure/schema";

/** What the Account page shows about signing in with Authentik. */
export type ExternalSignInStatus = Readonly<{
  /** Whether the player's Authentik account is linked. */
  linked: boolean;
  /** Whether an admin has set their real email (so the first Authentik sign-in links itself). */
  hasRealEmail: boolean;
}>;

/** The player's own link to Authentik, for their Account page (kind B: their own row). */
export async function externalSignInStatus(
  db: DbExecutor,
  actor: Actor,
): Promise<ExternalSignInStatus> {
  const [link] = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(
      and(eq(authAccounts.userId, actor.userId), eq(authAccounts.providerId, EXTERNAL_PROVIDER_ID)),
    );
  const [user] = await db
    .select({ email: authUsers.email })
    .from(authUsers)
    .where(eq(authUsers.id, actor.userId));
  return {
    linked: link !== undefined,
    hasRealEmail: user !== undefined && hasRealEmail(user.email),
  };
}
