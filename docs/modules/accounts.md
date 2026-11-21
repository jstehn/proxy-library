# Accounts, sign-in and social

Who a player is, how they sign in, what an admin controls, and profiles and friends. Code:
`src/modules/accounts/` and `src/modules/social/`; tokens and connector OAuth are described in
`llm-tools.md`. Checked against `refactor/main` (2026-11-20) by the tests named in brackets.

## Accounts

1. **Usernames are 3-20 characters from `a-z 0-9 _ -`,** stored lowercase and unique ("Jack" and "jack"
   sign in the same); display names are 1-40 characters after trimming; passwords are 6-128 characters,
   kept exactly as typed (spaces allowed) and stored only as Better Auth's hash. (doc 02 §4 rules 1-3,
   §14.2-3; `credentials.test.ts`, `accounts.test.ts`)
2. **The very first player registers without an invite and becomes an admin;** every later player
   needs an open invite, which works once and is rejected when used, revoked or expired. An invite
   lasts 1-30 days; a code typed in lowercase with spaces is accepted. (doc 02 §4 rules 4-5, §14.1;
   `accounts.test.ts`, `invite.test.ts`)
3. **There is always at least one active admin:** demoting or disabling the last one is refused, even
   for yourself; you cannot disable yourself. (doc 02 §4 rules 6-7; `accounts.test.ts`)
4. **A disabled player cannot sign in** and every current session ends at once; only admins create or
   revoke invites, promote or demote admins, toggle self-funding, disable or enable players and reset
   passwords; a temporary password forces a change at next sign-in and ends sessions; permission is
   checked in the use case, never only in the UI. (doc 02 §4 rules 8-10; `accounts.test.ts`)
5. **Wrong password and unknown user answer identically.** (doc 02; `accounts.test.ts`)
6. **Registration cleans up after itself:** if saving the player fails, the new credentials are
   deleted again. (doc 02 §8; `accounts.test.ts`)

## Sign-in with Authentik (optional)

7. **Authentik sign-in is on only when the issuer, client id and secret are all configured,** uses
   discovery, PKCE, a nonce and a verified ID token, and never creates an account (`disableSignUp`):
   a player links it from the Account page, or an admin sets a verified email. A visitor with no link
   is told so in words, and the finish route ends the session of a disabled player. The callback is the
   single route ADR 0028 mounts. (doc 69 §4, §13 option A, ADR 0028; `external-sign-in.test.ts`)
8. **A verified email is stored lower case,** emptying it puts the unverified placeholder back; an email
   already taken, or a non-admin trying, is refused. (doc 69 §4; `external-sign-in.test.ts`)

## Profiles and friends

9. **A bio is at most 500 characters after trimming;** favourite colours are normalised to WUBRG order
   without duplicates; favourite formats without duplicates; at most 3 distinct showcase cards, which
   must be cards the owner has; a showcase deck must belong to the owner and be shared. (doc 48-social
   §4 rules 6-8; `profile.test.ts`, `social.test.ts`)
10. **Friend requests:** not to yourself; at most one friendship per pair of players; only the addressee
    accepts or declines a pending request, only the requester cancels it, either side of an accepted
    friendship may unfriend; disabled players cannot send or accept and do not appear in the player
    directory. (doc 48-social §4 rules 1-5 and 9; `social.test.ts`)
11. **Each profile section has a visibility** of everyone, friends or only me. Stats default to
    everyone and the wishlist to friends. `/players/[username]` is the primary URL and also resolves a
    case-insensitive username or a user id. (doc 48-social §13.1-2; `profile.test.ts`)

## Open decisions

- Doc 02 §14.7 deferred the public profile page; doc 48-social built it. Not a conflict; listed so doc
  02's line is not read as current.
- The doc 02 session length (30 days, renewed while used) and temporary-password format (four random
  words) were not verified against the code in this package and are not listed as rules.
