import { err, ok, type Result } from "@/shared/kernel";
import {
  bearerSecret,
  looksLikeToken,
  MAX_LIVE_TOKENS,
  shouldTouch,
  TOKEN_NAME_MAX_LENGTH,
  tokenHash,
  tokenName,
  tokenPrefix,
  tokenSecret,
  withRead,
  type AccessToken,
  type AccessTokenId,
  type Scope,
} from "../domain/access-token";
import type { TokenNameInvalid, TokenNotFound, TooManyTokens } from "../domain/errors";
import { isActive, toActor, type Actor } from "../domain/player";
import type { AccountsDependencies } from "./ports";

// Personal access tokens (design doc 28, section 5.1): how an LLM client acts as a player.

export type CreateAccessTokenError = TokenNameInvalid | TooManyTokens;
export type CreateAccessTokenInput = Readonly<{ name: string; scopes: readonly string[] }>;

/** A new token and its secret. The secret exists only in this result (rule 2). */
export type CreatedAccessToken = Readonly<{ token: AccessToken; secret: string }>;

/** Who a valid token stands for, and what it may do. */
export type TokenActor = Readonly<{
  actor: Actor;
  scopes: readonly Scope[];
  tokenId: AccessTokenId;
}>;

/** Makes a token for the signed-in player. `read` is always one of its scopes. */
export function makeCreateAccessToken(dependencies: AccountsDependencies) {
  const { unitOfWork, secrets, clock } = dependencies;

  async function createAccessToken(
    actor: Actor,
    input: CreateAccessTokenInput,
  ): Promise<Result<CreatedAccessToken, CreateAccessTokenError>> {
    const name = tokenName(input.name);
    if (name === null) return err({ kind: "TokenNameInvalid", maximum: TOKEN_NAME_MAX_LENGTH });
    const secret = tokenSecret(secrets.accessTokenBytes());
    const hash = await tokenHash(secret);

    return unitOfWork.run<CreatedAccessToken, CreateAccessTokenError>(
      async ({ players, accessTokens }) => {
        // One player's token changes happen one at a time, so the limit can't be raced past.
        await players.lockAccounts();
        if ((await accessTokens.countLive(actor.userId)) >= MAX_LIVE_TOKENS) {
          return err({ kind: "TooManyTokens", maximum: MAX_LIVE_TOKENS });
        }
        const token = await accessTokens.insert({
          userId: actor.userId,
          name,
          prefix: tokenPrefix(secret),
          hash,
          scopes: withRead(input.scopes),
          createdAt: clock.now(),
        });
        return ok({ token, secret });
      },
    );
  }

  return createAccessToken;
}

/** Revokes one of the player's own tokens. Someone else's token is "not found". */
export function makeRevokeAccessToken(dependencies: AccountsDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function revokeAccessToken(
    actor: Actor,
    tokenId: AccessTokenId,
  ): Promise<Result<void, TokenNotFound>> {
    return unitOfWork.run<void, TokenNotFound>(async ({ accessTokens }) => {
      const revoked = await accessTokens.revoke(tokenId, actor.userId, clock.now());
      return revoked ? ok() : err({ kind: "TokenNotFound" });
    });
  }

  return revokeAccessToken;
}

/**
 * Who an `Authorization: Bearer …` header stands for (rule 1). Null for anything wrong: no
 * header, a wrong or revoked token, a disabled player, a player who must change their password.
 * Each answer is the same null, so a caller can't tell which.
 */
export function makeActorFromToken(dependencies: AccountsDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function actorFromToken(authorization: string | null): Promise<TokenActor | null> {
    const secret = bearerSecret(authorization);
    if (secret === null || !looksLikeToken(secret)) return null;
    const hash = await tokenHash(secret);

    const found = await unitOfWork.run(async ({ players, accessTokens }) => {
      const token = await accessTokens.findLiveByHash(hash);
      if (token === null) return ok(null);
      const player = await players.findById(token.userId);
      if (player === null || !isActive(player) || player.mustChangePassword) return ok(null);
      const now = clock.now();
      if (shouldTouch(token.lastUsedAt, now)) await accessTokens.touch(token.id, now);
      return ok({ actor: toActor(player), scopes: token.scopes, tokenId: token.id });
    });
    return found.ok ? found.value : null;
  }

  return actorFromToken;
}
