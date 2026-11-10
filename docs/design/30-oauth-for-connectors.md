# Design: OAuth sign-in for web connectors

- **Phase:** 30
- **Status:** **Approved** (2026-11-10; the user asked for it to be built straight away)
- **Related:** design doc 28 (LLM tools, access tokens), ADR 0022 (one tool registry), ADR 0012
  (Better Auth for sessions). No new ADR: this adds a sign-in route to tokens design doc 28
  already defined.

## 1. Purpose & scope

Web connectors (claude.ai's "Add custom connector", ChatGPT on the web) can't send a header
the player pastes in. They sign in with **OAuth 2.1** as the MCP authorization spec describes:
they discover the app's authorization server, register themselves as a client, send the player
to an approval page, and swap the approval for a token.

This phase makes the app its own small OAuth authorization server. **The token it hands out
is an ordinary access token** (`pl_…`, design doc 28), so `/api/mcp`, `/api/tools`, scopes,
"last used" and revoking all work unchanged. A connected app shows up in **Account → Access
tokens** like any other token, and is revoked the same way.

**In scope:** discovery metadata (RFC 9728, RFC 8414), dynamic client registration (RFC 7591,
public clients only), the authorization code grant with PKCE S256, an approval page, a token
endpoint, `WWW-Authenticate` pointing at the metadata.

**Out of scope:** refresh tokens and expiring tokens (access tokens don't expire; design doc
28 rule 16 already limits and revokes them), confidential clients and client secrets, the
implicit and password grants, token introspection and revocation endpoints (revoking is on the
Account page), OpenID Connect.

## 2. Ubiquitous language

| Term                   | Meaning in this codebase                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **OAuth client**       | An app that registered itself (claude.ai, an MCP inspector). It has an id, a self-chosen name and redirect URIs. |
| **Redirect URI**       | Where the approval page sends the browser back to, with the code. Must exactly match a registered one.           |
| **Authorization code** | A one-time, ten-minute secret that the approval page gives the client, and the client swaps for a token.         |
| **PKCE**               | The client sends a hash of a secret (the challenge) first, and the secret (the verifier) when it swaps the code. |
| **Connected app**      | An access token made by OAuth. It records the client it was made for.                                            |

## 3. Domain model

```ts
export type OAuthClient = Readonly<{
  clientId: string; // "plc_" + 32 random bytes, base64url
  name: string; // what the client called itself, trimmed to 60 characters
  redirectUris: readonly string[];
  createdAt: Date;
}>;

export type AuthorizationCode = Readonly<{
  clientId: string;
  userId: UserId;
  redirectUri: string;
  codeChallenge: string; // S256 only
  scopes: readonly Scope[];
  expiresAt: Date;
}>;
```

Pure functions in `domain/oauth.ts`: `redirectUriProblem(uri)`, `clientName(raw)`,
`pkceMatches(verifier, challenge)`, `requestedScopes(scopeParameter)`, `codeExpiry(now)`,
`tokenNameFor(clientName)`, and the secret makers (`clientIdFor`, `codeSecret`, reusing
`tokenHash`).

## 4. Invariants

1. **Redirect URIs** are `https://…`, or `http://localhost…` / `http://127.0.0.1…` (local
   tools). No fragments. At most 5 per client, each at most 500 characters.
2. **A bad client id or redirect URI is never redirected to.** The approval page shows an error
   instead, so it can't be used to bounce a browser to an attacker's site.
3. **PKCE with S256 is required.** A request without `code_challenge`, or with
   `code_challenge_method` other than `S256`, is refused.
4. **A code is used once** and lives ten minutes. Only its SHA-256 is stored. A second use, an
   expired code, or a code from another client or redirect URI is `invalid_grant`.
5. **Only a signed-in, active player who doesn't have to change their password** can approve
   (the approval page uses `requireActor`). The approval page shows the redirect host as well
   as the client's name, because anyone can register any name.
6. **The player chooses the scopes** on the approval page. `read` is always included; what the
   client asked for is pre-ticked.
7. **One live token per player and client.** Approving a client again revokes that client's
   earlier tokens for the player, so reconnecting doesn't use up the limit of 10 (design doc 28
   rule 16). The limit still applies, and the approval page says so before it hands out a code.
8. **A disabled player's or reset player's tokens** are revoked exactly as today; OAuth adds no
   way around it.

## 5. Use cases

All in the accounts module (`application/oauth.ts`):

- `registerOAuthClient({ clientName, redirectUris })` → `Result<OAuthClient, OAuthClientInvalid>`.
- `checkAuthorizationRequest(parameters)` → `Result<AuthorizationRequest, AuthorizationProblem>`:
  validates client, redirect URI, `response_type=code`, PKCE, and reads the scopes. Problems
  split into "show an error page" (bad client or redirect URI) and "redirect with `error=`".
- `approveAuthorization(actor, request, scopes)` → `Result<{ redirectTo }, TooManyTokens>`:
  stores a code and returns the redirect URI with `code` and `state`.
- `exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier })` →
  `Result<{ accessToken, scopes }, TokenProblem>`: takes the code (marking it used), checks
  PKCE, revokes the client's earlier tokens for the player, and makes a new access token named
  after the client.

## 6. Ports

`OAuthRepository`, in the accounts unit of work:

```ts
interface OAuthRepository {
  insertClient(client: OAuthClient): Promise<void>;
  findClient(clientId: string): Promise<OAuthClient | null>;
  insertCode(hash: string, code: AuthorizationCode): Promise<void>;
  /** The code with this hash if it's unused and unexpired, marking it used; else null. */
  takeCode(hash: string, now: Date): Promise<AuthorizationCode | null>;
}
```

`AccessTokenRepository` gains `revokeForClient(userId, clientId, at)`, and `NewAccessToken` an
optional `oauthClientId`. `SecretGenerator.accessTokenBytes()` (32 secure random bytes) also
makes client ids and codes.

## 7. State machines

A code: **issued** → **used** (once), or **issued** → **expired** (ten minutes pass).

## 8. Persistence

Migration `0031_oauth`:

- `oauth_clients` (`client_id` text primary key, `name`, `redirect_uris` text[], `created_at`).
- `oauth_codes` (`code_hash` text primary key, `client_id` → `oauth_clients` cascade, `user_id`
  → `players` cascade, `redirect_uri`, `code_challenge`, `scopes` text[], `expires_at`,
  `used_at`).
- `access_tokens.oauth_client_id` text, nullable, → `oauth_clients` on delete set null.

## 9. Endpoints and pages

| Route                                         | What                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /.well-known/oauth-protected-resource`   | RFC 9728: the resource (`/api/mcp`) and its authorization server (the app). Also at `…/api/mcp`. |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: endpoints, `code` + S256, `none` client auth, the scopes.                              |
| `POST /api/oauth/register`                    | RFC 7591 registration (JSON in and out).                                                         |
| `GET /oauth/authorize`                        | The approval page (signs in first, then comes back).                                             |
| `POST /api/oauth/token`                       | Form-encoded `authorization_code` grant; RFC 6749 error JSON.                                    |

Metadata, registration and token answers allow any origin (CORS), since browser-based MCP
tools call them; none of them uses a cookie. A 401 from `/api/mcp` and `/api/tools` adds
`resource_metadata="…/.well-known/oauth-protected-resource"` to `WWW-Authenticate`.

Signing in: the proxy sends a signed-out visitor to `/sign-in?next=<path>`, and signing in
returns to `next` when it's a path on this site (`/…`, not `//…`).

## 10. Events emitted

None.

## 11. Patterns applied

The same ports and adapters as access tokens. The token endpoint is a controller that turns a
`Result` into RFC 6749 JSON, as `/api/tools` does into its own errors.

## 12. Test plan

- **Unit** (`domain/oauth.test.ts`, `application/oauth.test.ts`, with the in-memory fakes):
  redirect URI rules, PKCE (the RFC 7636 example vector), scope reading, a code used twice, an
  expired code, the wrong verifier, client or redirect URI, reconnecting revokes the old token,
  the token limit.
- **Integration** (`src/app/_oauth/oauth.int.test.ts`): the whole dance against Postgres:
  register, check, approve, swap, then the token signs in to the MCP tools; and the Drizzle
  repository's `takeCode` is single-use.

## 13. Open questions

- Registration is open to anyone, as the MCP spec expects. A flood of registrations only adds
  rows; if it happens, delete clients with no tokens after a while.
