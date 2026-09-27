# 0012. Use Better Auth for identity only, behind a port

- **Status:** Proposed
- **Date:** 2026-09-27

## Context

The app needs usernames, password hashing, sessions and cookies. Writing these ourselves is
risky: security details are easy to get subtly wrong. Better Auth (v1.7) is a maintained
TypeScript library that supports Next.js 16 and Drizzle and does all of this.

It also offers extra features (an admin plugin with roles and bans, public HTTP endpoints for
sign-up and sign-in). Using those would split our permission rules between our code and the
library's, and would expose endpoints we don't control.

## Decision

- Better Auth handles **identity only**: credentials (username + scrypt password hash) and
  sessions (cookie + lookup).
- **Everything about permissions is ours**: `isAdmin`, `canSelfFund`, disabled state and invites
  live in the `accounts` module's own tables and rules. We don't use the admin plugin.
- Better Auth is used **only** inside `accounts/infrastructure`, behind the `IdentityProvider`
  port. No other module, page or component imports it (lint-enforced like any infrastructure).
- **No Better Auth HTTP routes are mounted.** All auth flows are our server actions calling
  `auth.api.*` on the server, with the `nextCookies` plugin to set cookies. Public sign-up is
  disabled in its config (`disableSignUp`), so registration can only happen through our
  `registerPlayer` use case with its invite rules.
- Its tables get an `auth_` prefix to mark them as owned by the library.

## Consequences

- ✅ We get well-tested password hashing and session handling without writing them ourselves.
- ✅ Permission rules live in one place, in plain domain code with tests.
- ✅ Swapping the library later would touch one adapter file plus its tables.
- ❌ Registration can't be one database transaction, because Better Auth writes on its own
  connection. We compensate by deleting the credentials if a later step fails (design doc 02,
  section 5).
- ❌ We must keep the generated `auth_*` schema in step with Better Auth upgrades (re-run its CLI
  and diff).

## Alternatives considered

- **Hand-rolled auth:** full control, but high risk for a learning project.
- **Better Auth with its admin plugin and HTTP endpoints:** less code, but permissions would be
  split between the library and our domain, plus a larger attack surface.
- **Auth.js (NextAuth):** oriented toward OAuth providers. Username/password support is
  deliberately minimal.
