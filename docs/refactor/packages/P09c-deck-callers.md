# P09c. Deck, draft and collection callers onto capabilities

- **Branch:** `refactor/P09c-deck-callers` · **Depends on:** P09b · **Parallel with:** P09d
- **Audit:** [milestone 1 review](../reviews/milestone-1.md), finding 1
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1)
  and [S5](../dedup-playbook.md#s5) · **Lines to remove:** about −500 to −900 (low confidence)

## Why

Wave 3 (P10–P14) and P17 change what the deck, draft and collection queries compute. If the pages
and actions still call those queries directly, each change has to be made twice. Moving them first
means wave 3 changes one caller.

## Touches

The paths under these folders in `NOT_YET_ON_CAPABILITIES` (`eslint.config.mjs`):

| Folder                                 | Files                                                                                                                            | `getContainer()` calls today |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src/app/decks/`                       | `actions.ts` (15), `commanders/*`, `[id]/page.tsx`, `[id]/export`, `[id]/print/*`, `proxies.pdf`, `shared`, `to-get`, `page.tsx` | 27                           |
| `src/app/drafts/`                      | `actions.ts` (15), `[id]/page.tsx`, `page.tsx`                                                                                   | 18                           |
| `src/app/collection/`                  | `real/actions.ts` (11), `page.tsx`, `real/page.tsx`                                                                              | 13                           |
| `src/app/d/`                           | `[token]/page.tsx`, `[token]/scorecard/page.tsx` (shared deck view)                                                              | 4                            |
| `src/app/cards/`, `src/app/inventory/` | `cards/[id]/*`, `inventory/*`                                                                                                    | 9                            |

Plus `wiring.ts` and `index.ts` in `decks`, `drafts`, `collection`, `real-collection` and
`inventory`. **Avoid:** `builder/` (done in P09b; components are P19's) and the P09d folders.

## Steps

Work **one folder at a time**, committing after each.

1. List each action and each page's reads in the folder. For each, write down the capability that
   already answers it, or "new". The [S1 table](../dedup-playbook.md#s1) and `src/server/capabilities.ts`
   are the lists of what exists.
2. Write the missing capabilities in the module's `application/` (a `make…` factory, unit test with
   fakes) and wire them in the module's `wiring.ts`.
3. Rewrite actions with `action(Schema, …)` and pages with `const { actor, capabilities } = await
readPage()`. Keep the output the page renders the same. Map failures with the module's
   `describe…Error`.
4. Delete the folder's paths from `NOT_YET_ON_CAPABILITIES`.
5. Delete module exports that no caller outside `wiring.ts` uses anymore (grep first). Delete query
   functions that nothing calls at all, and their tests.
6. Do `drafts/` with special care. Pick timers and the `api/drafts/[id]/events` stream (P09d's) share
   the draft service. Don't change the event shapes.

## Done when

- (From P09b) `app/decks/[id]/page.tsx` reads through `readPage()` and `capabilities.deckOverview`;
  `loadBuilderDeck` in `builder/actions.ts` is deleted.
- Nothing under `src/app/{decks,drafts,collection,d,cards,inventory}` calls `getContainer` or
  imports a query (except files in `CONTAINER_ALLOWED`, each with a reason).
- `decks/actions.ts` ≤ 200 lines. `drafts/actions.ts` and `collection/real/actions.ts` are shorter
  (record before and after).
- The `decks/index.ts` export count is lower than P09b's handoff number.
- `pnpm check` and `pnpm test:int` are green. Run the e2e suite (`tests/e2e/accounts.spec.ts` holds the deck, draft and collection flows).
- Deferrals go into the receiving package's file in the same commit.

## Handoff

**Done:**

- **Every page, route and action in `decks/`, `d/`, `drafts/`, `collection/`, `cards/` and
  `inventory/` is off `getContainer()`** and imports no query. `getContainer()` in `src/app`: 161 to
  90; `NOT_YET_ON_CAPABILITIES`: 84 to 60 files.
- **How they read:** pages and the form actions call `readPage()` (FormData actions take no parsed
  input, so `action(schema, …)` doesn't fit them; the schema-parsed actions in `builder/` use
  `action()`). Reads go through bundles that each module's `wiring.ts` builds with `withDb`
  (`src/shared/db/with-db.ts`: a query function with its database filled in): `deckReads`,
  `collectionReads`, `realCollectionReads`, `draftReads`, `inventoryReads`, `storeReads`,
  `catalogReads`, `packReads`, `wishlistReads`. New wiring files: `collection`, `real-collection`,
  `drafts`, `inventory`, `store`, `packs`.
- **Writes and services** are passed through `capabilities`: `deckEdits` (all of `Decks`),
  `deckSharing`, `chooseToken`, `proxySheet`, `drafts`, `realCollection`, `store`, `inventory`,
  `seeds`, `now()`. They are the modules' own application services, so the capabilities hand them over
  as they are.
- **New capability with logic and a test:** `proxyDeck` (`decks/application/proxy-deck.ts`): the
  deck as proxy lines and tokens, which `print/proxy-lines.ts` built by hand.
- **Builder:** `loadBuilderDeck` is split in two: `builderDeckFor(capabilities, userId, deckId)` in
  `builder/builder-deck.ts` (the deck page calls it) and the server action `loadBuilderDeck` that
  the builder component still calls to refresh.
- **Edit as text** moved to `decks/edit-as-text/actions.ts` (it was 180 of `decks/actions.ts`'s
  lines); `deckPath` moved to `decks/paths.ts`.
- **Exports:** the `index.ts` files of `decks`, `catalog`, `collection`, `drafts`, `inventory`,
  `real-collection`, `store`, `wishlist` and `packs` lost every name nothing outside the module uses
  (for example `catalog` 103 to 56 names, `real-collection` 49 to 23, `store` 62 to 38, `decks`
  217 to 216).
- **Checked:** `pnpm check` green, 281 of 281 integration tests, Playwright 26 of 26.

**Lines:** `decks/actions.ts` 383 to 197 (the target was ≤ 200). `drafts/actions.ts` 317 to 316 and
`collection/real/actions.ts` 284 to 287: those two only swapped the container call for
`capabilities`, so they are not shorter. Source 92,270 to 92,236 lines; code lines 79,262 to 79,180.
Still no real shrink: the bundles are one-line forwards. The saving the playbook hoped for needs the
queries behind them to merge (P11, P15 to P18), which is now one change each, not two.

**Found, not done:**

- Domain functions only tests use (candidates for P20, and for the question of whether the
  card-package and mulligan-trainer features are dead): `decks/domain` `planPackageInsert`,
  `dealMulliganDrill`, `evaluateMulliganDecision`, `chanceByTurn`, `exportWithTags`, `primerSections`,
  `preparedForTest`; `store` `msrpFor`; `social` `viewerRelation`, `defaultProfile`.
- `startDeckAction` in `decks/commanders/actions.ts` repeats `startDeck`'s create-and-import steps
  (it adds `usesRealCards`). Give `startDeck` that option in P11 or P19.
- The `ListPreviewSummary` mapping in `decks/edit-as-text/actions.ts` (about 70 lines) is
  presentation of a capability's answer; it belongs with P19 or P10.

**Not verified by eye:** the draft, inventory, opened-packs, cards, real collection and shared-deck
pages were not looked at in the browser; only what the e2e suite touches was exercised (deck,
shared deck, real collection, store, commanders). Added to `deferred-checks.md`.
