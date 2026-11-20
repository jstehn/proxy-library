# P35. Sign-in and connector OAuth through Authentik (a feature)

- **Branch:** `feature/P35-authentik` · **Depends on:** P25 (actors and the read layer) · **Parallel
  with:** waves 5 and 6 (it touches `accounts`, `src/server/session*`, `src/app/(auth)`,
  `src/app/oauth`, `src/app/_oauth` and `src/app/api/oauth`, which P29, P18 and P30 don't
  restructure; coordinate with P31–P33 on the sign-in page's look)
- **Source:** the owner's tududi inbox item (2026-11-20) and `docs/future-ideas.md`, "Players and
  economy"
- **Big feature:** a design doc (69) and the owner's approval before any code (ADR 0023). It also
  changes the homelab (`~/Projects/homelab/stacks/auth`), which isn't in this repo.
- **Lines:** a feature, so it may grow the count. If the connector OAuth server moves to Authentik
  (option B below), much of design doc 30's code can be deleted, which may make it net negative.

## Why

1. **Single sign-on.** The owner runs Authentik on the home lab
   (`https://auth.devstageprod.duckdns.org`, stack `auth`; OIDC clients so far: tududi). Players
   should be able to sign in to Proxy Library with it.
2. **Connectors that need a client ID and secret.** Connecting a client to production failed
   with "The Google redirect URL was rejected by the server. Enter your OAuth client ID and client
   secret to connect." The app's own OAuth server (design doc 30) only registers public clients
   (`token_endpoint_auth_method: "none"`, no secret) and only accepts some redirect URIs, so a
   connector that expects a confidential client, or a redirect it doesn't know, can't connect.

## Today

- **Sign-in:** Better Auth (ADR 0012), username and password, invite codes (`src/app/(auth)`,
  `accounts/infrastructure/better-auth.ts`).
- **Connectors:** the app is its own OAuth 2.1 authorization server (design doc 30): discovery,
  dynamic client registration for public clients, PKCE, an approval page (`/oauth/authorize`),
  and a token endpoint that issues an ordinary `pl_…` access token (design doc 28).

## Step 1: design doc 69 (no code before the owner approves it)

The doc decides, with options and a recommendation for each:

1. **Sign-in with Authentik.** Better Auth's generic OIDC support (check what version 1.7.6
   offers before choosing), alongside or instead of passwords. How an Authentik user is linked to
   an existing player (by verified email, or by an admin), what happens to invites, and how an
   admin is recognised (an Authentik group, or the existing admin flag).
2. **Connector OAuth.** Two options:
   - **(A) keep the app's own server** and add confidential clients (a client secret,
     `client_secret_basic`/`client_secret_post`), plus a clear error naming the rejected
     redirect URI;
   - **(B) make Authentik the authorization server** for `/api/mcp` and `/api/tools`: the app
     becomes a resource server that validates Authentik's tokens (JWKS) and maps a token's subject
     and scopes to a player and the tools' scopes. `pl_…` tokens stay for clients that send a header.
     Check whether Authentik supports dynamic client registration; if not, each connector's client
     ID and secret is created in Authentik and typed into the connector.
3. **Security:** the actor stays un-forgeable (design doc 67); token audience and issuer checks;
   what a revoked Authentik session or token does to a signed-in player and to a connector.
4. **The homelab side:** the Authentik provider and application (created through its API with the
   bootstrap token, like tududi's), the scope mappings, and the redirect URIs. These changes belong
   in `~/Projects/homelab/stacks/auth` and its README, done in the same session as the app side.
5. **Config:** env vars for the issuer, client ID and secret (read only through `shared/config`),
   and how local development works without Authentik (a fake issuer in tests; sign-in by password
   stays for dev and the e2e suite).
6. **Tests:** no network in automated tests: a local fake OIDC issuer, recorded discovery and
   JWKS documents, and access-rule tests for connector tokens.

## Steps after approval

Written in the design doc's own plan; the package is updated then.

## Needs the owner

- Approve design doc 69, including option A or B for connectors.
- Approve the homelab change (a new Authentik provider and application).

## Handoff

(empty)
