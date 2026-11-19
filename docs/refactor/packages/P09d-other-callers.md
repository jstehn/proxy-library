# P09d. The other callers onto capabilities

- **Branch:** `refactor/P09d-other-callers` · **Depends on:** P09b · **Parallel with:** P09c and
  wave 3 (it doesn't touch the deck, draft or collection folders)
- **Audit:** [milestone 1 review](../reviews/milestone-1.md), finding 1
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) ·
  **Lines to remove:** about −300 to −600 (low confidence; many of these files have one call)

## Touches

Everything left in `NOT_YET_ON_CAPABILITIES` after P09c's folders:

- **Pages and actions:** `account/`, `admin/`, `(auth)/`, `oauth/`, `activity/`, `friends/`,
  `players/`, `sets/`, `singles/`, `store/`, `trades/`, `wallet/` and `wishlist/`, plus the root
  `page.tsx` and `actions.ts`.
- **Header:** `site-header.tsx` (5 calls).
- **API routes:** `artwork`, `images`, `export/*`, `tools/openapi.json`, `drafts/[id]/events`,
  `health`.
- **OAuth:** `_oauth/http.ts`.

**Avoid:** the P09c folders and `builder/`.

## Steps

Follow P09c's steps 1–5, folder by folder, committing after each. In addition:

1. **Auth and sessions.** `(auth)/`, `oauth/`, `_oauth/http.ts` and the session cookie may need the
   container itself, not capabilities: they build the actor that capabilities take. Move what is
   logic (checking a password, issuing a token) into `accounts` capabilities. Keep the rest in
   `CONTAINER_ALLOWED`, with one reason comment per path.
2. **Image and artwork routes** stream files from the image cache. If no capability fits, an
   `images.read` capability that returns a stream or a path is fine. Don't move file streaming into
   a module's `domain/`.
3. **`site-header.tsx`** makes 5 calls on every page. Replace them with one `readPage()` and one
   capability (for example `accounts.headerSummary`: wallet balance, unread counts), so it costs one
   round trip.
4. **`api/drafts/[id]/events`** is a stream that stays open. Keep its subscription code
   (`getDraftSubscriptions`) as it is, and only move the initial read.

## Done when

- `NOT_YET_ON_CAPABILITIES` is empty and deleted from `eslint.config.mjs`. Only
  `CONTAINER_ALLOWED` remains, each path with a reason.
- `pnpm sizes` prints `getContainer() calls in src/app` equal to the number of `CONTAINER_ALLOWED`
  calls (expected under 10). Record it in STATUS's size table.
- `pnpm check` and `pnpm test:int` are green. The e2e suite passes in full: this package touches
  sign-in.
- Deferrals go into the receiving package's file in the same commit.

## Handoff

**Done:**

- **`getContainer()` in `src/app`: 191 at the baseline, 90 after P09c, 4 now**, in the two files of
  `CONTAINER_ALLOWED` (`_oauth/http.ts`, whose `issuer()` is read synchronously, and
  `api/health/route.ts`). `NOT_YET_ON_CAPABILITIES` is deleted. Every other page, route and action
  reads through `readPage()`.
- **`readPage()` grew options:** `{ admin: true }`, `{ allowPasswordChangePending: true }` and
  `{ allowVisitors: true }` (tested). `readCapabilities()` gives the routes that don't resolve a player
  (images, artwork, OpenAPI, the tool endpoints with their bearer token) the capabilities alone; they
  can't call `headers()` in the integration tests.
- **New wiring and bundles:** `accountReads`, `activityReads`, `socialReads`, `tradeReads`,
  `walletReads`; more entries in `catalogReads`, `storeReads`, `wishlistReads`, `draftReads`,
  `packReads`, `collectionReads`, `realCollectionReads`. New `wiring.ts` in `social`, `trades`,
  `wallet`, `activity`. Services passed through: `accounts`, `wallet`, `social`, `trades`, `wishlist`,
  `catalog`, `packs`, `resetPlayer`, `appUrl`.
- **`headerSummary`** (in `capabilities.ts`): the site header's five reads (balance, waiting trades,
  wishes at target, active draft, friend requests) are one call that runs them together instead of
  one after another.
- **`ToolContext`** carries `capabilities` instead of the whole container; the tests and
  `scripts/reference-outputs.ts` follow.
- **Checked:** `pnpm check` green, 281 of 281 integration tests, Playwright 26 of 26.

**Lines:** source 92,379 (92,236 after P09c), code lines 79,270 (79,180). The package added about 140
source lines: the wiring files and bundles are new, and the call sites are about as long as before.
**Wave 2½ as a whole did not shrink the code** (92,251 after wave 2, 92,379 now); it removed the
second path to the data. Net shrink now depends on the queries behind the bundles merging
(P11, P15 to P18) and on the removal list.

**Added to the removal list:** the two `CONTAINER_ALLOWED` entries, the growing service pass-through,
`headerSummary` and `readCapabilities()`; see [removal-list.md](../removal-list.md).

**Not verified by eye:** admin pages, account (profile, tokens, password), wallet, trades, friends,
wishlist, store, sets, singles, players' pages, the OAuth consent flow and the site header's counts.
The e2e suite touches sign-in, the store, the wishlist and tokens only. Added to `deferred-checks.md`.
