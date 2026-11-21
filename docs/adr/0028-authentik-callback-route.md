# 0028. Mount one Better Auth route: the Authentik callback

- **Status:** Accepted (owner, 2026-11-20; design doc 69, section 13, question 11)
- **Date:** 2026-11-20
- **Amends:** 0012

## Context

ADR 0012 says no Better Auth HTTP route is mounted: every auth flow is a server action that calls
`auth.api.*`. Signing in with Authentik (design doc 69) can't work that way. The OpenID Connect
code flow ends with the provider redirecting the browser to a URL on our site, with a code and a
state. Something has to receive that request, check the state cookie and the PKCE verifier,
exchange the code, verify the ID token, and set the session cookie. Better Auth does all of that
in its core `callback/:id` endpoint, and re-implementing it would be exactly the security-sensitive
code ADR 0012 chose a library to avoid.

## Decision

- Mount **exactly one** route, `GET /api/auth/callback/[provider]`
  (`src/app/api/auth/callback/[provider]/route.ts`). It calls `handleExternalCallback`, a use case
  that forwards the request to `auth.handler` behind the `IdentityProvider` port.
- Nothing else under `/api/auth` exists, so Better Auth's other endpoints (sign-up, sign-in, the
  social sign-in with an ID token, account linking, ...) stay unreachable over HTTP. Starting a
  sign-in or a link is still a server action calling `auth.api.*` (a form POST, so Next's origin
  check applies).
- Only `GET`: Authentik returns the code in the query string. A `POST` (`form_post`) isn't
  exported.
- The provider is registered only when `OIDC_*` is configured. Without it the route finds no
  provider and redirects to an error.
- The rest of ADR 0012 stands: identity only, permissions ours. A sign-in through Authentik
  links to an existing player and never creates one (`disableSignUp`); `is_admin` is never read
  from the provider; a player's tokens from the provider are stored encrypted
  (`encryptOAuthTokens`).

## Consequences

- ✅ State, PKCE, nonce and ID-token checks are the library's, not ours.
- ✅ The attack surface grows by one GET route.
- ❌ Better Auth reads the provider's discovery document when it starts. If the provider is down
  then, the sign-in button reports "not available" until the app restarts. Passwords are
  unaffected.
- ❌ The route is a place where an upgrade of Better Auth could change behaviour. The integration
  test (`authentik.int.test.ts`) runs the whole flow against a fake issuer, including a wrong
  issuer, audience, expiry, nonce and signing key.

## Alternatives considered

- **Hand-written OIDC client** (code exchange, JWKS verification with `jose`): about 300 lines of
  security-sensitive code, and a second place to keep right.
- **Mount all of Better Auth's handler:** exposes endpoints we deliberately don't use.
