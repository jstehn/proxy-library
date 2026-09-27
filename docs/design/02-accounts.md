# Design: Accounts & roles

- **Phase:** 2
- **Status:** **Approved** 2026-09-27, with changes: minimum password length 6; public profile page deferred
- **Related ADRs:** 0001 (modules), 0002 (factory DI), 0003 (Result), 0005 (unit of work),
  0009 (lint boundaries), **0012 (new: Better Auth for identity only)**

## 1. Purpose & scope

The `accounts` module answers two questions for the rest of the app:

1. **Who is this?** (_authentication_: proving identity with a username and password)
2. **What may they do?** (_authorization_: admin powers, the self-funding permission)

It covers registration with invite codes, signing in and out, the first-admin bootstrap, and
admin management of other players.

**Out of scope:**

- Money of any kind, including the self-funding _action_ itself. `wallet` (Phase 3) reads the
  `canSelfFund` permission defined here.
- Public profile pages and public stats like "total spent" or "self-funded". These are deferred
  to a later phase (see the roadmap backlog).
- Email of any kind: no verification, no password-reset emails. Nothing is ever sent.
- An audit log of admin actions (possible later via the `activity` module, Phase 11).

## 2. Vocabulary

| Term               | Meaning in this codebase                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **Player**         | A person with an account. Every user is a player; some players are also admins.                      |
| **Admin**          | A player with `isAdmin = true`, who can manage other players and create invites.                     |
| **Actor**          | The signed-in player performing an action. Every use case that needs permission receives one.        |
| **Invite code**    | A one-time code an admin creates and shares, needed to register (except for the very first player).  |
| **Disabled**       | A player who can no longer sign in. Their cards, money history and trades stay intact.               |
| **Self-funding**   | Permission (granted by an admin) to add money to your own wallet. Always publicly visible (Phase 3). |
| **Credentials**    | Username + password hash, stored and checked by Better Auth.                                         |
| **Session**        | "This browser is signed in as player X": a random token in a cookie, looked up on every request.     |
| **Authentication** | Checking _who_ someone is.                                                                           |
| **Authorization**  | Checking _what_ someone may do.                                                                      |

## 3. Domain model

```ts
// accounts/domain/player.ts
export type Player = Readonly<{
  userId: UserId;
  username: Username; // unique, lowercase, e.g. "jack"
  displayName: DisplayName; // shown to others, e.g. "Jack"
  isAdmin: boolean;
  canSelfFund: boolean;
  disabledAt: Date | null; // null = active
  mustChangePassword: boolean; // set after an admin reset
  joinedAt: Date;
}>;

/** The signed-in player, as seen by use cases. Only active players can be actors. */
export type Actor = Readonly<{
  userId: UserId;
  username: Username;
  displayName: DisplayName;
  isAdmin: boolean;
  canSelfFund: boolean;
  mustChangePassword: boolean;
}>;

// accounts/domain/invite.ts
export type InviteCode = Brand<string, "InviteCode">; // e.g. "K7QM-2XPA-9TRD"

export type Invite = Readonly<{
  code: InviteCode;
  createdBy: UserId;
  createdAt: Date;
  expiresAt: Date;
  usedBy: UserId | null;
  usedAt: Date | null;
  revokedAt: Date | null;
}>;

/** Derived, never stored: computed from the fields above and the current time. */
export type InviteStatus = "open" | "used" | "expired" | "revoked";

// Branded strings with validating companion objects (lesson 01, A6):
export type Username = Brand<string, "Username">; // Username.parse(raw): Result<Username, …>
export type DisplayName = Brand<string, "DisplayName">; // DisplayName.parse(raw)
export type Password = Brand<string, "Password">; // only checks length; never stored by us
```

**Why a boolean `isAdmin` instead of a list of roles:** there are exactly two kinds of player.
A boolean is simpler to read and check. If a third role ever appears, this becomes a union type
in a new ADR.

## 4. Rules (invariants)

Each rule maps to at least one test (section 12).

1. **Usernames** are 3–20 characters from `a–z 0–9 _ -`, stored lowercase, and unique.
   Signing in with "Jack" and "jack" is the same account.
2. **Display names** are 1–40 characters after trimming whitespace.
3. **Passwords** are at least 6 characters. We never store them, only Better Auth's scrypt hash.
4. **The very first player** registers **without** an invite code and becomes an admin. Every
   later registration **requires** an open invite.
5. **An invite works once.** Once used, revoked or expired, it's rejected.
6. **There is always at least one active admin.** Demoting or disabling the last active admin is
   refused. This includes doing it to yourself.
7. **You can't disable yourself** (ask another admin), which also prevents locking yourself out.
8. **Disabled players can't sign in**, and disabling someone ends all their current sessions
   immediately.
9. **Only admins** may create or revoke invites, promote or demote admins, toggle self-funding,
   disable or enable players, and reset passwords.
10. **Permission is checked inside the use case**, never only in the UI. Hiding a button is a
    convenience; the use case is the real guard.

Rules 4 and 6 need care with **concurrency** (two things happening at the same moment): two
people registering first at the same instant must not both become admin, and two admins demoting
each other at the same instant must not leave zero admins. Section 8 explains the lock that
prevents both.

## 5. Use cases

All return `Promise<Result<…>>`. "Actor" means the signed-in player, passed in by the controller.

| Use case            | Who                 | Input                                        | Success                  | Errors (`kind`)                                                                                                 |
| ------------------- | ------------------- | -------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `registerPlayer`    | anyone (signed out) | username, displayName, password, inviteCode? | the new `Player`         | `UsernameInvalid`, `DisplayNameInvalid`, `PasswordTooShort`, `InviteRequired`, `InviteNotOpen`, `UsernameTaken` |
| `signIn`            | anyone (signed out) | username, password                           | `Actor` (+ cookie set)   | `InvalidCredentials`, `AccountDisabled`                                                                         |
| `signOut`           | any actor           | —                                            | —                        | —                                                                                                               |
| `changeOwnPassword` | any actor           | currentPassword, newPassword                 | — (clears `mustChange…`) | `InvalidCredentials`, `PasswordTooShort`                                                                        |
| `createInvite`      | admin               | validForDays (1–30, default 7)               | `Invite`                 | `Forbidden`                                                                                                     |
| `revokeInvite`      | admin               | code                                         | —                        | `Forbidden`, `InviteNotOpen`                                                                                    |
| `setAdmin`          | admin               | userId, isAdmin                              | updated `Player`         | `Forbidden`, `PlayerNotFound`, `LastAdmin`                                                                      |
| `setSelfFunding`    | admin               | userId, allowed                              | updated `Player`         | `Forbidden`, `PlayerNotFound`                                                                                   |
| `setDisabled`       | admin               | userId, disabled                             | updated `Player`         | `Forbidden`, `PlayerNotFound`, `CannotDisableSelf`, `LastAdmin`                                                 |
| `resetPassword`     | admin               | userId                                       | a one-time temp password | `Forbidden`, `PlayerNotFound`                                                                                   |

Also, used by every page and action:

- **`getActor(requestHeaders)`**: returns the signed-in `Actor`, or `null` if signed out,
  disabled, or the session is unknown. Not a `Result`, because "nobody is signed in" is a normal
  answer, not an error.

### How `registerPlayer` works, step by step

```
open transaction
  take the accounts lock                         (section 8: one registration at a time)
  if no players exist yet  → this player will be admin; no invite needed
  else                     → invite code required, and must be open → otherwise err
  create credentials in Better Auth              (a separate database write, see below)
  insert the player row (isAdmin as decided above)
  mark the invite used (if one was needed)
commit
```

Better Auth writes the credentials using its own database connection, so that write is **not**
part of our transaction. If anything fails _after_ the credentials were created, the use case
calls `identity.deleteUser(userId)` to undo it (a _compensating action_). The worst case, a crash
between the two writes, leaves credentials without a player row. `getActor` treats that as
"not signed in", so it's harmless, and the username stays reserved until an admin cleans it up.

### Temporary passwords

`resetPassword` generates a random temporary password, shows it **once** to the admin (to pass
on in person or by chat), sets `mustChangePassword = true`, and ends the player's sessions. After
signing in with it, the player is sent to "change your password" before anything else.

## 6. Ports

Interfaces the application layer needs (section B2 of lesson 01 explains ports and adapters).

```ts
// accounts/application/ports.ts

/** Credentials and sessions. Implemented with Better Auth (ADR 0012). */
export interface IdentityProvider {
  createUser(input: {
    username: Username;
    displayName: DisplayName;
    password: Password;
  }): Promise<Result<UserId, { kind: "UsernameTaken" }>>;
  deleteUser(userId: UserId): Promise<void>; // compensating action only
  signIn(input: {
    username: Username;
    password: Password;
  }): Promise<Result<UserId, { kind: "InvalidCredentials" }>>;
  signOut(): Promise<void>;
  currentUserId(): Promise<UserId | null>;
  changePassword(input: {
    current: Password;
    next: Password;
  }): Promise<Result<void, { kind: "InvalidCredentials" }>>;
  setPassword(userId: UserId, password: Password): Promise<void>; // admin reset
  endAllSessions(userId: UserId): Promise<void>;
}

/** Our own player data (write side). */
export interface PlayerRepository {
  lockAccounts(): Promise<void>; // section 8
  countPlayers(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  findById(userId: UserId): Promise<Player | null>;
  insert(player: Player): Promise<void>;
  update(player: Player): Promise<void>;
}

export interface InviteRepository {
  insert(invite: Invite): Promise<void>;
  findByCode(code: InviteCode): Promise<Invite | null>;
  update(invite: Invite): Promise<void>;
}

/** Random invite codes and temporary passwords, from the OS random source. */
export interface SecretGenerator {
  inviteCode(): InviteCode;
  temporaryPassword(): Password;
}
```

Plus `Clock` and `UnitOfWork` from the kernel.

| Port               | Real adapter (infrastructure)                    | Test fake (testing/)        |
| ------------------ | ------------------------------------------------ | --------------------------- |
| `IdentityProvider` | `betterAuthIdentityProvider` (wraps Better Auth) | `inMemoryIdentityProvider`  |
| `PlayerRepository` | `drizzlePlayerRepository`                        | `inMemoryPlayerRepository`  |
| `InviteRepository` | `drizzleInviteRepository`                        | `inMemoryInviteRepository`  |
| `SecretGenerator`  | `cryptoSecretGenerator` (shared/runtime)         | `sequentialSecretGenerator` |

## 7. State machines

**Player:** `active ⇄ disabled` (admin action, subject to rules 6–7). `isAdmin` and
`canSelfFund` are independent switches.

**Invite:** `open → used`, `open → revoked`, `open → expired` (by time passing, derived, not
stored). `used`, `revoked` and `expired` are final. One pure function decides the status:

```ts
export function inviteStatus(invite: Invite, now: Date): InviteStatus;
```

## 8. Persistence

Tables owned by `accounts`, in `accounts/infrastructure/schema.ts`:

**Better Auth's tables**, generated by its CLI and renamed with an `auth_` prefix so it's obvious
we don't write to them ourselves: `auth_users`, `auth_sessions`, `auth_accounts` (Better Auth's
name for "a way to sign in", not our player accounts), `auth_verifications`.

**Our tables:**

```sql
players (
  user_id              text primary key references auth_users(id),
  is_admin             boolean not null default false,
  can_self_fund        boolean not null default false,
  disabled_at          timestamptz,
  must_change_password boolean not null default false,
  created_at           timestamptz not null
)

invites (
  code        text primary key,
  created_by  text not null references players(user_id),
  created_at  timestamptz not null,
  expires_at  timestamptz not null,
  used_by     text unique references players(user_id),
  used_at     timestamptz,
  revoked_at  timestamptz
)
```

Username and display name live in `auth_users` (Better Auth's `username` and `name` columns). The
repository joins them into a `Player`.

### The accounts lock

`lockAccounts()` runs `select pg_advisory_xact_lock(<accounts lock id>)`. That's a Postgres lock
on a made-up number rather than a table row, which is held until the transaction ends. Every use
case that checks "how many players / admins are there?" takes it first. So registrations and admin
changes happen **one at a time**, and each sees the result of the previous one. With a handful of
friends, the waiting is unnoticeable.

### Usernames without email

Better Auth's username plugin still requires an email field. We store a placeholder,
`<username>@players.invalid`. The `.invalid` domain is reserved by internet standards (RFC 2606)
never to exist, so nothing can ever be delivered there. It's never shown.

## 9. Read models (queries)

| Query                  | Used by          | Returns                                                       |
| ---------------------- | ---------------- | ------------------------------------------------------------- |
| `listPlayers(db)`      | `/admin/players` | username, display name, admin?, self-fund?, disabled?, joined |
| `listInvites(db, now)` | `/admin/invites` | code, status, created by, expires, used by                    |
| `hasAnyPlayers(db)`    | `/register`      | whether to show the invite-code field                         |

## 10. Screens and request flow

| Route               | Who        | Purpose                                                  |
| ------------------- | ---------- | -------------------------------------------------------- |
| `/register`         | signed out | register (invite field hidden when there are no players) |
| `/sign-in`          | signed out | sign in                                                  |
| `/account/password` | signed in  | change password (forced when `mustChangePassword`)       |
| `/admin/players`    | admin      | promote/demote, self-funding, disable, reset password    |
| `/admin/invites`    | admin      | create, list, revoke invites                             |

- **All forms are server actions** (controllers): parse the form with Zod, get the actor, call
  the use case, and turn the `Result` into a message with an exhaustive `switch`.
- **No public Better Auth HTTP endpoints.** Everything goes through our server actions, so the
  only ways in are the ones this document lists. Better Auth's `nextCookies` plugin lets server
  actions set the session cookie.
- **`proxy.ts`** (Next 16's name for middleware) only checks whether a session cookie is
  _present_ and redirects signed-out visitors to `/sign-in`. That's a convenience. The real check
  is `getActor` in every page and action (rule 10).
- Sessions last **30 days** and are renewed while in use.

## 11. Patterns applied

- **Ports & adapters (2):** Better Auth sits behind `IdentityProvider`, so no other module
  imports it (ADR 0012).
- **Factory DI (3), Result (7), branded types (8):** `Username`, `DisplayName`, `Password` and
  `InviteCode` are brands with `parse` functions that return `Result`s.
- **Repository (4) + unit of work (5):** players and invites change together in one transaction.
- **Parse, don't validate (9):** form data is parsed once in the server action. Brands carry the
  proof inward.
- **State machine (13):** invite status is a pure function of the invite and the time.
- **Injected nondeterminism (17):** codes and temp passwords come from `SecretGenerator`, and
  expiry from `Clock`.
- **Contract tests (18):** in-memory and Drizzle repositories pass the same test suite.
- **Deliberate deviation:** registration compensates with `deleteUser` instead of being fully
  transactional, because Better Auth writes on its own connection. Explained in section 5.

## 12. Test plan

- **Domain (unit + property):** `Username.parse` / `DisplayName.parse` / `Password.parse` (edge
  cases, and a property that anything accepted is lowercase and within limits); `inviteStatus`
  for every state, including the exact expiry instant; the last-admin and self-disable rules.
- **Use cases (fakes):** first player becomes admin without an invite; later ones need an open
  invite (used, revoked and expired all rejected); `UsernameTaken`; compensation runs when
  inserting the player fails; every admin use case returns `Forbidden` for non-admins;
  `LastAdmin`; `CannotDisableSelf`; reset sets `mustChangePassword` and ends sessions.
- **Contract tests:** player and invite repositories, in-memory vs Drizzle.
- **Integration (real Postgres + Better Auth):** create user → sign in → change password →
  sign in with the new one; a disabled player's sign-in is refused and their sessions end.
  **Concurrency:** two simultaneous first registrations produce exactly one admin; two admins
  demoting each other simultaneously leave one admin.
- **End-to-end (Playwright, set up in this phase):** first visitor registers and becomes admin →
  creates an invite → a second browser registers with it → admin disables them → their sign-in
  is refused.

## 13. Lesson 02 outline

"Authentication, authorization and forms": sessions and cookies explained from scratch; password
hashing; the difference between authentication and authorization; server actions and HTML forms;
parsing `FormData` with Zod; policy functions; database locks and race conditions (why "check,
then act" breaks under concurrency); wrapping a third-party library behind a port; client
components and `useActionState` for form feedback.

## 14. Decisions from review

1. Invite lifetime: **7 days by default**, admin picks 1–30.
2. Minimum password length: **6** (changed in review).
3. Username rules: **3–20 of `a–z 0–9 _ -`**.
4. Session length: **30 days, renewed while in use**.
5. Temp password format: **4 random words from a small built-in list** (easy to read aloud,
   e.g. `lotus-goblin-ember-tower`), versus random characters.
6. Can an admin grant self-funding **to themselves**? **Yes.** It's the same switch, and because
   self-funding is always public (Phase 3), it stays transparent.

7. Public profile page (`/players/[username]`): **deferred** to a later phase.
