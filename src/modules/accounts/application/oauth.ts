import { err, ok, type Result } from "@/shared/kernel";
import {
  MAX_LIVE_TOKENS,
  tokenHash,
  tokenPrefix,
  tokenSecret,
  withRead,
  type Scope,
} from "../domain/access-token";
import type {
  AuthorizationRefused,
  OAuthClientInvalid,
  RedirectUriNotRegistered,
  TokenRequestRefused,
  TooManyTokens,
  UnknownClient,
} from "../domain/errors";
import {
  clientIdFor,
  clientName,
  codeExpiry,
  codeSecret,
  isChallenge,
  MAX_REDIRECT_URIS,
  pkceMatches,
  redirectUriProblem,
  requestedScopes,
  tokenNameFor,
  withQuery,
  type OAuthClient,
} from "../domain/oauth";
import { isActive, type Actor } from "../domain/player";
import type { AccountsDependencies } from "./ports";

// OAuth for web connectors (design doc 30, section 5). The token at the end is an ordinary
// access token (design doc 28), so the tool endpoints don't change.

export type RegisterClientInput = Readonly<{
  clientName?: string;
  redirectUris: readonly string[];
}>;

/** The query parameters of `GET /oauth/authorize`, as given (null when missing). */
export type AuthorizationParameters = Readonly<{
  clientId: string | null;
  redirectUri: string | null;
  responseType: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  scope: string | null;
  state: string | null;
}>;

/** A request worth showing the approval page for. */
export type AuthorizationRequest = Readonly<{
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  /** What the client asked for; the page pre-ticks these (rule 6). */
  scopes: readonly Scope[];
  state: string | null;
}>;

/** Problems the approval page shows itself (rule 2), or sends back to the client. */
export type AuthorizationProblem = UnknownClient | RedirectUriNotRegistered | AuthorizationRefused;

export type ApproveError = AuthorizationProblem | TooManyTokens;

/** Where to send the browser next. */
export type Redirect = Readonly<{ redirectTo: string }>;

/** The form body of `POST /api/oauth/token`. */
export type TokenRequest = Readonly<{
  grantType: string | null;
  code: string | null;
  clientId: string | null;
  redirectUri: string | null;
  codeVerifier: string | null;
}>;

export type IssuedToken = Readonly<{ accessToken: string; scopes: readonly Scope[] }>;

/** RFC 7591 registration: any app may register, with redirect URIs that follow rule 1. */
export function makeRegisterOAuthClient(dependencies: AccountsDependencies) {
  const { unitOfWork, secrets, clock } = dependencies;

  async function registerOAuthClient(
    input: RegisterClientInput,
  ): Promise<Result<OAuthClient, OAuthClientInvalid>> {
    const redirectUris = [...new Set(input.redirectUris)];
    if (redirectUris.length === 0) {
      return err({
        kind: "OAuthClientInvalid",
        reason: "redirect_uris must list at least one URI",
      });
    }
    if (redirectUris.length > MAX_REDIRECT_URIS) {
      return err({
        kind: "OAuthClientInvalid",
        reason: `redirect_uris may list at most ${MAX_REDIRECT_URIS} URIs`,
      });
    }
    for (const uri of redirectUris) {
      const problem = redirectUriProblem(uri);
      if (problem !== null) {
        return err({ kind: "OAuthClientInvalid", reason: `redirect URI ${uri} ${problem}` });
      }
    }
    const client: OAuthClient = {
      clientId: clientIdFor(secrets.accessTokenBytes()),
      name: clientName(input.clientName),
      redirectUris,
      createdAt: clock.now(),
    };
    return unitOfWork.run<OAuthClient, OAuthClientInvalid>(async ({ oauth }) => {
      await oauth.insertClient(client);
      return ok(client);
    });
  }

  return registerOAuthClient;
}

/** Checks an authorization request before the approval page is shown (rules 1 to 3). */
export function makeCheckAuthorizationRequest(dependencies: AccountsDependencies) {
  const { unitOfWork } = dependencies;

  async function checkAuthorizationRequest(
    parameters: AuthorizationParameters,
  ): Promise<Result<AuthorizationRequest, AuthorizationProblem>> {
    if (parameters.clientId === null) return err({ kind: "UnknownClient" });
    const clientId = parameters.clientId;
    const found = await unitOfWork.run(async ({ oauth }) => ok(await oauth.findClient(clientId)));
    const client = found.ok ? found.value : null;
    if (client === null) return err({ kind: "UnknownClient" });

    // With one registered URI the parameter may be left out (RFC 6749, section 3.1.2.3).
    const redirectUri =
      parameters.redirectUri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
    if (redirectUri === null || !client.redirectUris.includes(redirectUri)) {
      return err({ kind: "RedirectUriNotRegistered" });
    }

    const refuse = (
      error: AuthorizationRefused["error"],
      description: string,
    ): Result<never, AuthorizationRefused> =>
      err({
        kind: "AuthorizationRefused",
        error,
        description,
        redirectUri,
        state: parameters.state,
      });
    if (parameters.responseType !== "code") {
      return refuse("unsupported_response_type", "Only response_type=code is supported.");
    }
    if (parameters.codeChallengeMethod !== "S256") {
      return refuse("invalid_request", "PKCE is required, with code_challenge_method=S256.");
    }
    if (parameters.codeChallenge === null || !isChallenge(parameters.codeChallenge)) {
      return refuse("invalid_request", "code_challenge must be base64url(SHA-256(verifier)).");
    }
    return ok({
      client,
      redirectUri,
      codeChallenge: parameters.codeChallenge,
      scopes: requestedScopes(parameters.scope),
      state: parameters.state,
    });
  }

  return checkAuthorizationRequest;
}

/**
 * The player approved: stores a one-time code and says where to send the browser (rule 4).
 * The request is checked again, since it comes back from a form.
 */
export function makeApproveAuthorization(
  dependencies: AccountsDependencies,
  checkAuthorizationRequest: ReturnType<typeof makeCheckAuthorizationRequest>,
) {
  const { unitOfWork, secrets, clock } = dependencies;

  async function approveAuthorization(
    actor: Actor,
    parameters: AuthorizationParameters,
    chosenScopes: readonly string[],
  ): Promise<Result<Redirect, ApproveError>> {
    const checked = await checkAuthorizationRequest(parameters);
    if (!checked.ok) return checked;
    const request = checked.value;
    const code = codeSecret(secrets.accessTokenBytes());
    const hash = await tokenHash(code);
    const now = clock.now();

    return unitOfWork.run<Redirect, ApproveError>(async ({ accessTokens, oauth }) => {
      // Rule 7: this client's earlier token will be replaced, so it doesn't count.
      const live = await accessTokens.countLive(actor.userId, request.client.clientId);
      if (live >= MAX_LIVE_TOKENS) return err({ kind: "TooManyTokens", maximum: MAX_LIVE_TOKENS });
      await oauth.insertCode(hash, {
        clientId: request.client.clientId,
        userId: actor.userId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scopes: withRead(chosenScopes),
        expiresAt: codeExpiry(now),
      });
      return ok({ redirectTo: withQuery(request.redirectUri, { code, state: request.state }) });
    });
  }

  return approveAuthorization;
}

/** The player said no: back to the client with `error=access_denied`. */
export function makeDenyAuthorization(
  checkAuthorizationRequest: ReturnType<typeof makeCheckAuthorizationRequest>,
) {
  async function denyAuthorization(
    parameters: AuthorizationParameters,
  ): Promise<Result<Redirect, AuthorizationProblem>> {
    const checked = await checkAuthorizationRequest(parameters);
    if (!checked.ok) return checked;
    const { redirectUri, state } = checked.value;
    return ok({ redirectTo: withQuery(redirectUri, { error: "access_denied", state }) });
  }

  return denyAuthorization;
}

/**
 * Swaps a code for an access token (RFC 6749, section 4.1.3, with PKCE). The code is used up
 * first, in its own transaction, so a failed swap can't be retried with the same code.
 */
export function makeExchangeAuthorizationCode(dependencies: AccountsDependencies) {
  const { unitOfWork, secrets, clock } = dependencies;

  async function exchangeAuthorizationCode(
    request: TokenRequest,
  ): Promise<Result<IssuedToken, TokenRequestRefused>> {
    const refuse = (
      error: TokenRequestRefused["error"],
      description: string,
    ): Result<never, TokenRequestRefused> =>
      err({ kind: "TokenRequestRefused", error, description });
    if (request.grantType !== "authorization_code") {
      return refuse("unsupported_grant_type", "Only grant_type=authorization_code is supported.");
    }
    const { code: secret, clientId, codeVerifier } = request;
    if (secret === null || clientId === null || codeVerifier === null) {
      return refuse("invalid_request", "code, client_id and code_verifier are required.");
    }
    const hash = await tokenHash(secret);
    const taken = await unitOfWork.run(async ({ oauth }) =>
      ok(await oauth.takeCode(hash, clock.now())),
    );
    const code = taken.ok ? taken.value : null;
    const invalid = refuse("invalid_grant", "The code is wrong, used or expired.");
    if (code === null || code.clientId !== clientId) return invalid;
    if (request.redirectUri !== null && request.redirectUri !== code.redirectUri) return invalid;
    if (!(await pkceMatches(codeVerifier, code.codeChallenge))) return invalid;

    const accessToken = tokenSecret(secrets.accessTokenBytes());
    const accessTokenHash = await tokenHash(accessToken);
    return unitOfWork.run<IssuedToken, TokenRequestRefused>(
      async ({ players, accessTokens, oauth }) => {
        // One player's token changes happen one at a time, so the limit can't be raced past.
        await players.lockAccounts();
        const player = await players.findById(code.userId);
        const client = await oauth.findClient(code.clientId);
        if (player === null || !isActive(player) || player.mustChangePassword || client === null) {
          return invalid;
        }
        const now = clock.now();
        await accessTokens.revokeForClient(player.userId, client.clientId, now);
        if ((await accessTokens.countLive(player.userId)) >= MAX_LIVE_TOKENS) {
          return refuse("invalid_grant", `You already have ${MAX_LIVE_TOKENS} access tokens.`);
        }
        await accessTokens.insert({
          userId: player.userId,
          name: tokenNameFor(client.name),
          prefix: tokenPrefix(accessToken),
          hash: accessTokenHash,
          scopes: code.scopes,
          createdAt: now,
          oauthClientId: client.clientId,
        });
        return ok({ accessToken, scopes: code.scopes });
      },
    );
  }

  return exchangeAuthorizationCode;
}
