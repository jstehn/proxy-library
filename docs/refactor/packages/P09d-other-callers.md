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

(empty)
