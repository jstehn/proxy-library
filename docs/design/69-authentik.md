# Design: Sign-in and connector OAuth through Authentik

- **Phase:** Refactor package P35 (a feature; the owner's inbox item of 2026-11-20)
- **Status:** Proposed (awaiting the owner's approval)
- **Related ADRs:** 0012 (Better Auth, identity only; this doc proposes ADR 0028 to amend its "no routes mounted" rule), 0023 (process), 0026 (capabilities)
- **Related design docs:** 28 (access tokens, `pl_…`), 30 (the app's own OAuth server), 67 (`Actor`, `readTool`)
- **Lesson:** deferred (the refactor defers lessons); topics when written: the OIDC code flow with PKCE, verifying a JWT against a JWKS

Written from `refactor/main` at "P35: sign-in and connector OAuth through Authentik". No code
changes with this doc. Line counts are from that commit. Things I could not check are marked
**(unverified)**; section 11 lists them together.

## 1. Purpose & scope

Two separate problems, one provider:

1. **Sign in with Authentik** (single sign-on). The owner's Authentik (`2026.8.5`, at
   `https://auth.devstageprod.duckdns.org`, tududi is an OIDC client already) becomes a second way
   into the app.
2. **Connectors that need a client ID and secret.** Connecting a client to production fails
   with "The Google redirect URL was rejected by the server. Enter your OAuth client ID and
   client secret to connect." (section 2). The question is whether to fix it in the app's own OAuth
   server (**A**) or hand connector OAuth to Authentik (**B**).

The two are independent: sign-in is the same under A and B, and it can ship first.

**Out of scope:** the Authentik side beyond what the app needs (section 9 only describes it), social
logins (Google and the like) in Authentik, and refresh tokens for the app's own server unless
section 2 says they are needed.

## 2. Diagnosis of the reported failure

The sentence is the **client's** (Google's connector UI), not ours. Every message our server
produces is different ("redirect URI … must use https…"). Google shows it when its automatic
registration (RFC 7591) fails, or succeeds without giving it what it needs, and then asks for a
client ID and secret by hand. So the app turned the connector away at one of these points
(`src/app/_oauth/http.ts`, `registerClient`, and `accounts/application/oauth.ts`,
`registerOAuthClient`). In order of how likely I think they are:

1. **No secret and no confidential method.** The metadata says
   `token_endpoint_auth_methods_supported: ["none"]` and the registration answer is always
   `token_endpoint_auth_method: "none"` with no `client_secret`, whatever the client asked for. A
   client that asked for `client_secret_basic` or `client_secret_post` gets a public client back
   and, if it insists on a secret, falls back to the manual form. This matches "enter your client ID
   and client secret" and matches the package's own description.
2. **More redirect URIs than we allow.** `MAX_REDIRECT_URIS = 5`; the route's Zod schema allows 20.
   A vendor that registers many (per region or per product) gets a 400 "redirect_uris may list at
   most 5 URIs", and the client shows only its generic text.
3. **A redirect URI `redirectUriProblem` refuses.** Anything not `https://…` or `http://localhost`
   or `http://127.0.0.1`, a fragment, over 500 characters, or a custom scheme (`app://…`).
4. **`grant_types_supported: ["authorization_code"]` only.** A client that requires
   `refresh_token` in the server's metadata gives up before it registers. We issue tokens that
   never expire, so a refresh token is never needed, but the client can't know that.

I can't tell which from the code alone, because the production 400 body isn't logged. **First step
of the build, whichever option wins:** log (at info level, no secrets) each registration request's
client name, redirect URIs, requested auth method and grant types, and the reason when it is
refused. One real attempt then settles it. Also, the 400 errors already name the rejected URI
(`redirect URI <uri> <problem>`); the part missing is the same naming on the approval page, which
today says only "an address it didn't register" (`problemWords`).

## 3. What the installed versions support

### 3.1 Better Auth 1.7.6 (read from `node_modules/better-auth/dist`)

- **Generic OAuth plugin** (`better-auth/plugins`, `genericOAuth({ config: [...] })`). Each
  provider is registered as a social provider: sign-in goes through the core `signIn.social`
  endpoint (`auth.api.signInSocial({ body: { provider, callbackURL, errorCallbackURL } })` on the
  server) and the browser returns to the core `GET|POST /callback/:id`. No plugin-specific routes.
- **Config per provider:** `providerId`, `discoveryUrl` (fills authorization, token, userinfo and
  end-session endpoints, issuer and JWKS), `clientId`, `clientSecret`,
  `authentication: "basic" | "post"` (token endpoint auth), `scopes`, `pkce` (default **on**),
  `requireIdTokenVerification` (fail closed when discovery lacks issuer/JWKS), `disableSignUp`,
  `disableImplicitSignUp`, `requireEmailVerification`, `overrideUserInfo`, `mapProfileToUser`,
  `accountSubject` (default: the ID token's `sub`), `redirectURI`, `endSessionEndpoint` and
  `disableProviderLogout`. The ID token's **nonce** is bound to the request by default (turn off
  only with `disableIdTokenNonceBinding`). `private_key_jwt` is supported; we don't need it.
- **State and CSRF:** the plugin generates `state` and the PKCE verifier and stores them (database
  `verification` table plus a signed cookie); a callback without a valid state is redirected to the
  error URL.
- **Account linking** (`account.accountLinking`: `enabled`, `trustedProviders`,
  `disableImplicitLinking`, `allowDifferentEmails`, `requireLocalEmailVerified` default **true**,
  `updateUserInfoOnLink`). A sign-in whose email matches an existing user links to it only if the
  provider is trusted **or** reports the email verified, **and** the local user's email is verified.
  Our users have placeholder emails (`<username>@players.invalid`, `emailVerified = false`), so
  **nothing links implicitly today**. `linkSocial` (`POST /link-social`) links the provider to the
  _signed-in_ user and needs no email match when `allowDifferentEmails` is on.
- **Not in this install:** the separate `@better-auth/sso` package (not installed; only
  `@better-auth/drizzle-adapter` is), and Better Auth as an OIDC/MCP provider (`oidcProvider`, `mcp`
  plugins are not in `dist/plugins`). Neither is needed.
- **ADR 0012 conflict:** it says no Better Auth HTTP route is mounted. The callback needs one.
  Proposal: mount **only** `src/app/api/auth/callback/[provider]/route.ts`, which calls
  `auth.handler(request)`. Nothing else under `/api/auth` exists, so Better Auth's other endpoints
  stay unreachable. Recorded as **ADR 0028**.

I haven't run the flow end to end; the above is from the source and types.

### 3.2 Authentik 2026.8.5 (from docs.goauthentik.io; I couldn't query the live instance)

| Capability                           | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic client registration          | **Yes since 2026.8.0, but not anonymous.** It is turned on per provider; the registration call needs a Bearer token carrying the scope `https://goauthentik.io/oidc/dcr-scope`, and the token's user must pass the application's policies. Each registration **creates a new application and provider**. `POST …/application/o/<slug>/register/`. No RFC 7592 management; objects stay until someone deletes them. Edition limits not stated. |
| Client types, auth methods           | Confidential (`client_secret_basic` default, `client_secret_post`) and public (`none`, PKCE). Registration accepts all three.                                                                                                                                                                                                                                                                                                                 |
| PKCE                                 | Supported.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Redirect URIs                        | Exact strings or regular expressions; the docs recommend exact. Empty means "trust the first URI used", which we never use.                                                                                                                                                                                                                                                                                                                   |
| Scopes                               | Custom **scope mappings** (property mappings with an expression) add claims; an application can restrict which scopes a provider offers.                                                                                                                                                                                                                                                                                                      |
| JWKS, discovery                      | Per application: `/application/o/<slug>/jwks/` and `/application/o/<slug>/.well-known/openid-configuration`. Signing is asymmetric only if the provider has a signing key; otherwise **HS256 with the client secret**, which a resource server can't verify. Choose RS256.                                                                                                                                                                    |
| Introspection                        | A global `/application/o/introspect/`; confidential providers may introspect their own tokens.                                                                                                                                                                                                                                                                                                                                                |
| Issuer                               | Per provider (`…/application/o/<slug>/`) by default, or global.                                                                                                                                                                                                                                                                                                                                                                               |
| Refresh tokens                       | Yes, with `offline_access`; rotation is automatic.                                                                                                                                                                                                                                                                                                                                                                                            |
| `email_verified`                     | Defaults to **false** since 2025.10 unless a mapping sets it. The homelab's tududi comment says Authentik reports admin-set emails as verified, so a mapping or setting is in place **(unverified which)**.                                                                                                                                                                                                                                   |
| Access tokens are JWTs, `aud`, `sub` | The page doesn't say. tududi's `OIDC_ACCESS_TOKEN_AUDIENCE` equals its client ID, so I expect `aud` = client ID and `sub` = hashed user ID by default, with a signed JWT access token **(unverified)**. Whether a `scope` claim is present **(unverified)**; section 6.2 has a fallback.                                                                                                                                                      |
| Resource indicators (RFC 8707)       | Not mentioned. Assume the audience is always the client ID.                                                                                                                                                                                                                                                                                                                                                                                   |

## 4. Sign-in with Authentik

### 4.1 Alongside passwords, or instead

**Options.** (a) alongside; (b) Authentik only, passwords removed; (c) Authentik only in production,
passwords in dev.

**Recommendation: (a).** Passwords stay for development, the e2e suite (which must not need
Authentik), the first admin (the first player registers without an invite), and the day Authentik is
down or its host is being rebuilt (tududi keeps password login for the same reason). The
sign-in page gets a "Sign in with Authentik" button **only when the OIDC settings are present**; with
none set, nothing changes. A player may have a password, an Authentik link, or both.

### 4.2 Linking an Authentik user to a player

The rule: **an Authentik identity (`sub`) is attached to exactly one existing player, by one of two
deliberate acts, and never by guessing.** Better Auth's `auth_accounts` row (`providerId =
"authentik"`, `accountId = sub`) is the link.

1. **A signed-in player links themselves** (Account page, "Link Authentik"): `linkSocial` from the
   player's own session. No email trust needed; the player proved both accounts are theirs. This is
   the safe default and the only path when the emails differ.
2. **An admin sets the player's real email** (Admin → Players → "Email", verified by the admin's
   say-so; this overwrites the placeholder and sets `emailVerified`). Then the player's first
   Authentik sign-in links automatically when Authentik's email matches. This needs `account.accountLinking`
   with `trustedProviders: ["authentik"]`; since we don't trust Authentik's `email_verified`
   (section 3.2), we trust **the provider**: Authentik here has no self-enrollment and the owner sets
   every email. If that ever changes, this trust must go (open question 9).

**Unknown Authentik users get nothing.** `disableSignUp: true` on the provider: an identity with no
link and no matching verified email is sent back to `/sign-in?error=authentik-unlinked` with the
words "No Proxy Library player is linked to this Authentik account. Sign in with your password and
link it from your Account page, or ask an admin." No `auth_users` row is created, so no orphan
credentials exist (today's `getActor` would reject one anyway: no player row means no actor).

### 4.3 Invites

Invites keep working unchanged: `/register` with an invite code creates a player with a password
(design doc 02). The new player then links Authentik from their Account page. **Authentik does not
bypass the invite**, so being given an Authentik account doesn't by itself admit anyone to the
library. Alternative (open question 3): auto-create a player for anyone in an Authentik group, as
tududi's `OIDC_AUTO_PROVISION` does, with the group acting as the invite. Not recommended for the
first version: it needs a player-without-password path, a username rule for it, and the first-admin
logic to ignore it.

### 4.4 Admins

**Keep the existing `players.is_admin` flag; don't read an Authentik group.** Reasons: the last-admin
rule and the accounts lock already live there (design doc 02), a group claim would make Authentik a
second source of truth that could silently demote or promote someone on sign-in, and a mistake in an
Authentik group policy would grant admin to the whole library. An Authentik user is as much an admin
as the player they link to. (Option: a `groups` claim sync; open question 4.)

### 4.5 The session flow

```
/sign-in  "Sign in with Authentik"  (server action, a form POST, so Next's origin check applies)
  → auth.api.signInSocial({ provider: "authentik", callbackURL: "/sign-in/finish?next=<safe>",
                            errorCallbackURL: "/sign-in?error=authentik" })
  → 302 to Authentik (state, PKCE challenge S256, nonce)
  → Authentik signs the user in (its own session/MFA) and redirects to
    {APP_URL}/api/auth/callback/authentik?code=…&state=…
  → Better Auth checks state, swaps the code (client secret), verifies the ID token
    (issuer, audience = our client ID, signature from the JWKS, expiry, nonce),
    finds the linked user, writes the usual Better Auth session cookie
  → 302 to /sign-in/finish: a server page that calls getActor();
       actor present → redirect to safeNextPath(next) ?? "/", or /account/password if required
       no actor (disabled or no player row) → end the session, show the same message as password sign-in
```

After the callback the app's own cookie session is independent of Authentik (30 days, renewed; design
doc 02). The password change rule `mustChangePassword` still applies to the player.

Sign-out ends the app session; it does not sign the player out of Authentik (`disableProviderLogout:
true` for the first version, so signing out of Proxy Library doesn't also sign them out of tududi).

### 4.6 Local development and the e2e suite

- With no `OIDC_*` variables set, the button doesn't render and the provider isn't registered. Dev
  and the e2e suite behave exactly as today.
- Tests that cover the Authentik path use a **local fake issuer** (section 10), not Authentik.
- `.envrc` doesn't set the OIDC variables. A developer who wants to try the real thing sets them in
  `.envrc.local` and registers `http://localhost:3000/api/auth/callback/authentik` in Authentik
  (a second redirect URI on the same provider, section 9).

## 5. Connector OAuth, option A: keep the app's own server, add confidential clients

### 5.1 What it is

The app stays the authorization server of design doc 30 and learns four things:

1. **Registration accepts `token_endpoint_auth_method`** of `none` (as now), `client_secret_basic` or
   `client_secret_post`. For the two confidential methods it makes a secret (32 random bytes,
   `pls_` prefix), stores only its SHA-256, and returns `client_secret` once with
   `client_secret_expires_at: 0`. The metadata lists all three methods.
2. **The token endpoint authenticates confidential clients** (Basic header or form fields),
   comparing hashes in constant time. A confidential client without a valid secret gets `invalid_client`
   (401 with `WWW-Authenticate: Basic`). Public clients are as before; PKCE stays mandatory for all.
3. **Manual clients.** An admin page ("Admin → Connectors") creates a client by hand: name, the
   exact redirect URIs the connector shows, confidential or public. It shows the client ID and the
   secret **once**, to paste into the connector's "OAuth client ID / secret" fields. This is the
   case the Google error asks for. It also lists, revokes and deletes clients (deleting a client
   revokes its tokens through the existing `oauth_client_id` link).
4. **Better redirect rules and errors.** `MAX_REDIRECT_URIS` 5 → 20 (the route's own cap already
   says 20); `https` and loopback `http` stay; the approval page names the URI it was sent and the
   ones registered ("This app sent `https://…`, which it did not register. Registered: …"), and
   the server logs it. No wildcards, no custom schemes (open question 7).

### 5.2 Code, from the real files

|                | Lines                                                                                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added (source) | about 400: domain (`secret` helpers, client kinds) 50, `application/oauth.ts` 110 (registration, client authentication, admin create/list/delete), `_oauth/http.ts` 50, admin page and actions 150, repository and migration `0xxx_oauth_confidential` (columns `client_secret_hash`, `auth_method`, `created_by`) 40 |
| Added (tests)  | about 300: domain, use-case with fakes, one integration test of the confidential dance                                                                                                                                                                                                                                |
| Deleted        | nothing                                                                                                                                                                                                                                                                                                               |

Current size of what A builds on: `domain/oauth.ts` 116, `application/oauth.ts` 296, `_oauth/http.ts`
152, `oauth/authorize/*` 204, tests 417. A grows the app's OAuth server from about 1,200 lines to
about 1,900 (with tests).

### 5.3 Security

- The app remains an authorization server: it holds clients and secrets (hashed), issues tokens, and
  must keep getting the details right (exact redirect matching, single-use codes, PKCE). Design doc
  30's invariants stand and have tests; A adds secret comparison and "a code belongs to the client
  that authenticated". The surface is small and already reviewed, but it is ours to maintain.
- Open registration stays open to anyone (the MCP spec expects it); a confidential client made
  that way gets a secret only the registrant sees, and it can do nothing until a signed-in player
  approves it on the approval page, which shows the redirect host.
- Tokens are ordinary `pl_…` tokens (design doc 28): scoped, hashed, per-player, no expiry, revoked
  on the Account page or when the player is disabled or reset. The player still ticks the scopes.

### 5.4 Operations (the owner, per connector)

- **Connector with automatic registration** (claude.ai, ChatGPT, MCP Inspector): nothing.
- **Connector that asks for an ID and secret** (the Google case): Admin → Connectors → New client,
  paste the redirect URL the connector shows, copy the ID and secret into the connector, then
  approve on the approval page. About one minute, no homelab change, no redeploy.

### 5.5 When Authentik is down

Connectors keep working and so does sign-in by password. Only "Sign in with Authentik" fails.

### 5.6 Tests

Domain tests for the new rules, use-case tests with the in-memory fakes (wrong secret, secret on a
public client, code from another client, redirect error wording), an integration test of the whole
confidential flow, and the same `oauth.int.test.ts` style as today. No network.

## 6. Connector OAuth, option B: Authentik is the authorization server

### 6.1 What it is

`/api/mcp` and `/api/tools` become a **resource server**:

- `readTool` accepts two kinds of bearer: `pl_…` (as now) and a **JWT** from Authentik (three
  dot-separated parts). Anything else is a 401 that looks like every other 401.
- A JWT is verified with `jose` (already a dependency of Better Auth; it would become a direct one):
  signature against the application's JWKS (fetched from discovery, cached in memory, refetched at
  most once a minute on an unknown `kid`, stale keys kept up to 24 hours if Authentik is
  unreachable), algorithms limited to RS256/ES256, `iss` equal to the configured issuer, `aud` in the
  configured **audience allowlist**, `exp` and `nbf` with 30 seconds of tolerance, `sub` present.
- **Subject to player:** `sub` is looked up as `auth_accounts(providerId = "authentik", accountId =
sub)`, the very link made for sign-in (section 4.2). A connector therefore needs the player to
  have linked Authentik first. No link, a disabled player, or `mustChangePassword`: 401.
- **Scopes:** Authentik scope mappings named `read`, `decks:write`, `wishlist:write` map one to
  one. The token's `scope` claim (or a custom claim `proxylib_scopes` from a scope-mapping expression,
  if Authentik does not put `scope` in the access token **(unverified)**) is passed through
  `withRead`, so unknown words are dropped and `read` is always there.
- **Metadata:** `oauth-protected-resource` names Authentik's issuer as `authorization_servers`;
  `oauth-authorization-server` is deleted (clients read Authentik's). `WWW-Authenticate` keeps its
  `resource_metadata`.
- **Registration:** Authentik's DCR is **not anonymous** (section 3.2): a client must already hold
  a token with the DCR scope. claude.ai, ChatGPT and Google register anonymously, so they cannot
  self-register at Authentik. The owner creates one provider and application per connector
  (through the API) and pastes the client ID and secret into the connector. (The DCR creates
  an application and provider per registration anyway, which would also need cleaning up.)
- **Audience:** with a provider per connector, `aud` differs per connector. The app needs the list
  (`CONNECTOR_AUDIENCES`, comma-separated client IDs), so a new connector means an Authentik
  provider **and** a change to the app's environment and a redeploy. A single shared client for all
  connectors avoids the list but defeats per-connector revocation and shares a secret across vendors.
  A database list with an admin page removes the redeploy but costs about 150 lines (open
  question 6).

### 6.2 Code, from the real files

|                | Lines                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added (source) | about 330: verifier with JWKS cache 120, claims-to-actor mapping and scope rules 60, `readTool` and `handleMcp`/`handleToolCall` changes 40, metadata 40, config and port 40, `findByAccount` repository method 30                                                                                                                                                                                                        |
| Added (tests)  | about 300: fake issuer (shared with sign-in tests), verifier, access-rule tests                                                                                                                                                                                                                                                                                                                                           |
| Deleted        | about 1,150: `domain/oauth.ts` 116, `application/oauth.ts` 296, `_oauth/http.ts` 152 (minus about 40 kept), `oauth/authorize/*` 204, `api/oauth/*` and `.well-known/oauth-authorization-server` routes about 30, OAuth repository code, fakes and contract about 150, tests 417 (`oauth.test.ts` 199 + 69, `oauth.int.test.ts` 149); a migration drops `oauth_clients`, `oauth_codes` and `access_tokens.oauth_client_id` |

Net about **minus 500** lines, **minus 800** counting only source. It also removes a security-sensitive
feature the app has to maintain.

### 6.3 Security

- A mature authorization server (Authentik) issues, scopes and rotates tokens; we only validate.
  Less to get wrong in our code, though what we do write (audience, issuer, algorithm pinning) must
  be exact, and a wrong audience list is a real hole: a token minted for **another** Authentik
  application (tududi!) must never open the library. Hence an explicit allowlist, never "any token
  from this issuer", and a test for exactly that.
- **Revocation is slower.** A JWT is valid until `exp`. Disabling or resetting a player takes effect
  at once (the player is read on every request), but ending an Authentik session or deleting a
  grant takes up to the access-token lifetime, which the owner sets to 15 to 60 minutes. Per-request
  introspection would fix that at the cost of a network call per tool call and a new way to be down;
  not proposed.
- The player no longer chooses scopes on an approval page: Authentik's consent screen shows the
  requested scopes but doesn't let them be unticked. The scopes a provider may grant are limited by
  its configured scope mappings, so a connector can be made read-only by what the provider offers.
- Authentik-issued connector tokens don't appear in **Account → Access tokens**; the player revokes
  them in Authentik, the owner by disabling the player or removing the provider.

### 6.4 Operations (the owner, per connector)

Create provider and application in Authentik (a script over its API, section 9), put the client ID
in `CONNECTOR_AUDIENCES`, redeploy, paste ID and secret into the connector. Several minutes and a
homelab change **per connector**, including the automatic-registration clients (claude.ai,
ChatGPT) that need nothing under A. Each player must have linked Authentik before their connector
works.

### 6.5 When Authentik is down

New connections fail. Connected clients keep working until their access token expires (at most an
hour) and then can't refresh; cached JWKS keys are used meanwhile. `pl_…` tokens and the header-based
clients are unaffected. Password sign-in still works. In short: a home-lab outage becomes a connector
outage.

### 6.6 Tests

A fake issuer (section 10) mints JWTs with a test key. Access-rule tests: wrong issuer, wrong
audience (a token for another client of the same issuer), expired, not yet valid, `alg: none`,
HS256 signed with the public key, unknown `kid` (refetch once, then refuse), unlinked `sub`,
disabled player, missing `read`, unknown scopes dropped, a `pl_` token still working. Integration:
the MCP route end to end with a JWT.

## 7. Recommendation on connectors

**A: keep the app's own server and add confidential clients, plus manual clients.**

- It fixes the reported failure in either of its likely causes (section 2), and adds the manual path
  the Google error itself asks for, with the owner in control of the redirect URIs.
- B's main attraction, deleting about 800 lines of source, is real, but its costs fall on the
  owner every time: a per-connector provider, an environment change and a redeploy, because
  Authentik's registration isn't anonymous and the audience isn't ours to choose. Connectors would
  then depend on a home-lab service, and players lose scope choice and the connected-apps list.
- The two aren't exclusive: the sign-in link in section 4.2 is the same mapping B needs, so B can be
  added later (even beside A) if Authentik gets anonymous registration, or the owner prefers to give
  up the app's OAuth server. Nothing in A blocks that.

A balanced reading: if the owner's main wish is "one place for identity and tokens", B is the cleaner
end state and the owner should pick it; if it is "make connectors connect", A is cheaper, safer to
operate, and sooner.

## 8. Security (both options)

1. **The `Actor` stays unforgeable (design doc 67).** Nothing in this doc creates an `Actor` outside
   `getActor` (cookie session), `actorFromToken` (`pl_…`, A) or the JWT verifier (B). All three
   end in `toActor(player)` from our own `players` row after the active and password checks. Claims
   from Authentik (groups, names, email, `is_admin`) never flow into an `Actor`; at most they pick
   which player a **linked** `sub` belongs to. `AdminActor` still comes only from `asAdmin`.
2. **Issuer and audience.** Sign-in: Better Auth checks the ID token's issuer (from discovery,
   `requireIdTokenVerification: true`), audience (our client ID), signature, expiry and nonce. The
   configured issuer must equal the discovery document's. B: section 6.1; an allowlist, never a
   wildcard.
3. **What revoking does.**

| Revoked in Authentik / app                   | Browser session                                 | Connector token                                       |
| -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Authentik session ended                      | stays until the app session expires or is ended | A: unaffected. B: works until the JWT expires         |
| Authentik user disabled or deleted           | no new sign-ins; open app sessions stay         | A: unaffected. B: until expiry, no refresh            |
| Player disabled, reset or deleted in the app | ended at once (existing rule)                   | A: tokens revoked (existing). B: 401 on the next call |
| Player unlinks Authentik                     | stays (password still works)                    | B: 401 at once (no link)                              |
| `pl_…` token revoked                         | n/a                                             | at once                                               |

So the app does **not** follow an Authentik logout (no back-channel logout; **unverified** whether
Authentik 2026.8 or Better Auth 1.7.6 supports it). The mitigation is the app's own disable switch. 4. **CSRF and state on sign-in.** The start is a server action (a POST from our own origin).
Better Auth's `state` and PKCE verifier are bound to the browser by its signed cookie and database
row; a callback with a missing, wrong or reused state is refused. The ID token nonce is on. 5. **Open redirects.** `next` goes through `safeNextPath` before it's put into `callbackURL`;
`callbackURL` and `errorCallbackURL` are relative paths, and Better Auth's `trustedOrigins` is
the app's own origin. The redirect URI at Authentik is one exact string (section 9). Under A,
registered redirect URIs are matched exactly and a bad one is never redirected to (design doc 30,
rule 2). 6. **No account takeover through email.** Implicit linking exists only for admin-set, admin-verified
emails and only for the trusted provider. A player's self-service email edit does not exist, so
no one can claim another's address. 7. **Secrets.** `OIDC_CLIENT_SECRET` and any connector client secrets are never logged and aren't
in `.envrc`; the registration log (section 2) records neither secrets nor tokens.

## 9. The homelab side (described here, not made)

All of this belongs in `~/Projects/homelab/stacks/auth` and its README, and is done in the same
session as the app side. The way tududi's was set up: through Authentik's API with
`AUTHENTIK_BOOTSTRAP_TOKEN`. The exact endpoint and field names below are from memory of the v3 API
and must be checked against the instance's own schema (`/api/v3/schema/`) when written
**(unverified)**.

1. **A group** `proxy-library`, and an application policy binding that allows only that group, so
   Authentik decides who may even reach the app.
2. **An OAuth2/OpenID provider** `proxy-library`:
   client type **confidential**; client ID generated; client secret generated; **signing key** set to
   an RSA certificate (without one, tokens are HS256 and cannot be verified by anyone but the
   holder of the secret); `sub` mode left at the default (hashed user ID is stable); issuer mode
   per provider; **redirect URIs, strict, exact:** `https://<production APP_URL host>/api/auth/callback/authentik`
   and `http://localhost:3000/api/auth/callback/authentik` for development; scopes `openid`, `email`,
   `profile`; the authorization flow with explicit or implicit consent as for tududi; the same email
   mapping tududi uses (so the email arrives verified).
3. **An application** `proxy-library` (slug `proxy-library`, provider above, launch URL the app).
   Discovery is then at
   `https://auth.devstageprod.duckdns.org/application/o/proxy-library/.well-known/openid-configuration`.
4. **Option A:** nothing more. **Option B**, per connector: a provider and application, scope
   mappings `read`, `decks:write`, `wishlist:write` (and the `proxylib_scopes` expression if needed),
   an access token validity of 15 to 60 minutes, refresh tokens with `offline_access`, the connector's
   exact redirect URI.
5. `stacks/auth/compose.yml`'s header comment: "OIDC clients so far: tududi, proxy-library".
   `stacks/README.md`'s `auth` row likewise. A short README note on how to add a client (the API
   calls above), so the next one isn't archaeology.
6. **Secrets:** the client secret goes into the `proxylib-stack` environment in Portainer (the
   homelab's convention: secrets only in Portainer's env panel), never into the repo. tududi's
   client ID sits in its compose file; the secret doesn't.
7. Nginx Proxy Manager: no change, the public name already serves Authentik; the app's callback is
   served by the app's existing public host (`APP_URL`).

## 10. Tests

No network anywhere (project rule). Pieces:

- **A fake OIDC issuer** (`tests/support/fake-oidc-issuer.ts`, a plain Node HTTP server on
  `127.0.0.1`, a random port) serving a discovery document, a JWKS with a generated RSA test key,
  an authorization endpoint that redirects straight back with a code, and a token endpoint that
  returns a signed ID token (and, for B, access tokens) for a chosen user. Signing with `jose`.
  Tests ask it to misbehave: wrong issuer, wrong audience, expired, bad nonce, `email_verified`
  false, unknown `sub`.
- **Recorded documents** `tests/fixtures/authentik/{openid-configuration,jwks}.json`, taken once
  from the real instance (public data), parsed by the same Zod schema the app uses, so a change in
  Authentik's shape shows in a test, not in production.
- **Domain and use-case tests** with the in-memory fakes: link rules, unlinked identity refused,
  disabled player refused, `safeNextPath` for the callback, scope mapping (B).
- **Integration** (`pnpm test:int`, local Postgres): the Better Auth callback against the fake issuer
  (link by account page, link by admin email, refusal of an unknown identity), and for A the
  confidential client dance; for B the MCP route with JWTs.
- **E2E:** one Playwright spec against the fake issuer (sign in, land signed in, an unlinked user is
  refused); the existing suite is untouched and runs without any OIDC setting.
- **Access rules** (the checklist in 6.6 for B, 5.6 for A) are tests of the pure functions, so they run
  with `pnpm test`.

## 11. Config

All through `shared/config` (the only reader of `process.env`), validated by Zod:

| Variable                               | Meaning                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`                      | The provider's issuer, e.g. `…/application/o/proxy-library/` (discovery from it) |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The confidential client's credentials                                            |
| `OIDC_PROVIDER_NAME`                   | Button label, default "Authentik"                                                |
| `CONNECTOR_AUDIENCES` (option B only)  | Comma-separated client IDs whose tokens open `/api/mcp`                          |

Either all of the first three are set or none (a half-set group fails fast at startup with a readable
message, like today's missing variables). With none set the feature is off. The loaded `Config`
gains `oidc?: { issuerUrl, clientId, clientSecret, providerName }`. The variables are optional, so
neither `.envrc` nor the e2e config changes.

**Production:** `deploy/stack.yml` passes them through in the shared `x-app` environment, as it does
`REDDIT_CLIENT_ID`: `OIDC_ISSUER_URL: ${OIDC_ISSUER_URL:-}` and the rest (empty means off). They
are set in the `proxylib-stack` environment in Portainer. `scripts/deploy.sh` keeps its current
secrets handling and doesn't generate these (they come from Authentik, not from random); `docs/deploy.md`
and `.env.example` document them. The same lines go into `docker-compose.yml`.

## 12. Build plan (after approval)

1. **Registration log and approval-page wording** (small; ships alone and answers section 2).
2. **Sign-in**: config, `genericOAuth` provider, the callback route, ADR 0028, `/sign-in/finish`,
   the button, Account page link/unlink, admin email, the fake issuer and its tests, e2e spec.
3. **Option A** (or B if the owner chooses it): clients, token endpoint, admin page, migration.
4. **Homelab**: provider, application, group, README (section 9), in the same session as step 2.

Net lines: sign-in about +450 source and +350 tests; A about +400 and +300 more; B about -500 net.

## 13. Open questions

1. **Sign-in alongside passwords or instead?** (a) alongside, (b) instead, (c) instead in production
   only. **Recommend (a)**: the fallback, development, e2e and the first admin all need passwords.
2. **How is an Authentik user linked to a player?** (a) the player links from their Account page,
   (b) plus an admin-set verified email for automatic first-time linking, (c) an admin types the
   Authentik user. **Recommend (a) and (b).**
3. **Do Authentik users need an invite?** (a) yes, register with an invite, then link; (b) anyone in
   an Authentik group becomes a player on first sign-in. **Recommend (a)** for now; (b) can come
   later as one more use case.
4. **Who is an admin?** (a) the existing flag, (b) an Authentik group claim. **Recommend (a).**
5. **Connector OAuth: A or B?** **Recommend A**, with B possible later (section 7). This is the
   decision I most need.
6. **If B:** the audience list in an environment variable (redeploy per connector) or in the database
   with an admin page (about 150 more lines)? **Recommend the database.**
7. **If A:** raise the redirect-URI cap to 20, keep exact matching, no wildcards or custom schemes?
   **Recommend yes**, and loosen further only if the registration log (step 1) shows a real client
   needing it.
8. **If A and the log shows a client that insists on refresh tokens:** add expiring access tokens and
   refresh tokens (design doc 30 excluded them), or keep non-expiring tokens and advertise only
   `authorization_code`? **Recommend keep as is** until a log line proves it is needed.
9. **Trust Authentik's email for linking?** (a) trust the provider because the owner sets every
   email and Authentik has no self-enrollment, (b) require `email_verified` from Authentik, which is
   false by default since 2025.10. **Recommend (a)**, with the rule written into the README so
   enabling self-enrollment later means revisiting it.
10. **Back-channel logout / ending app sessions when Authentik ends one?** **Recommend not now**:
    the app's disable switch covers it, and I could not verify support in either product.
11. **ADR 0028** amending ADR 0012 to mount exactly one Better Auth route (the callback). **Recommend
    yes.**

## 14. Not verified (checked against nothing, or only against documentation)

- Authentik access tokens being JWTs with `aud` = client ID, the `sub` format, and a `scope` claim.
- How the homelab's Authentik reports `email_verified` as true (a mapping or setting).
- Authentik API endpoint and field names in section 9, and whether DCR needs an enterprise licence.
- Whether claude.ai, ChatGPT and Google send the ID and secret as `client_secret_basic` or `_post`
  (A supports both), and which of the four causes in section 2 is real.
- Better Auth's end-to-end behaviour (read from its source, not run), and back-channel logout in
  either product.
