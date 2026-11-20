# P25. The read layer, secure by construction

- **Branch:** `refactor/P25-read-layer` · **Depends on:** P23, P24 (P24 removes `goldfishSessions` from the container) · **Parallel with:** P26 (the second to merge resolves conflicts)
- **Source:** [plan review](../reviews/plan-review/README.md) (P25, owner answer 3), reports [1](../reviews/plan-review/1-architecture.md) and [3](../reviews/plan-review/3-app-and-ui.md)
- **Lines:** −1,100 to −1,800. Step 8 checks the real number. It replaces P20's old rows "pass-through" and "formAction".
- **Big feature:** needs a design doc and the owner's approval before code (ADR 0023). See "Needs the owner".

## Why

Capabilities sit beside 14 one-line `*Reads` forward bundles and 17 services passed through whole
(`deckEdits` is all of `Decks`). `Capabilities` is a bag of about 120 names. The owner chose an
honest query layer (answer 3 a): **reads are each module's typed query functions, written once and
called directly by pages and actions. Capabilities are for writes and for anything with rules or
permissions.** The owner also wants the layer **secure by construction**: you can't call a
per-player query without the signed-in player.

## Deletes

Verify with `grep` before starting; counts are from `refactor/main` at `cc8f0f7`.

| What                                                                                                                                                                                                                                                   | Where                                                                                                        | Lines          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------- |
| The 14 forward bundles: `activityReads`, `catalogReads`, `wishlistReads`, `collectionReads`, `deckReads`, `accountReads`, `inventoryReads`, `draftReads`, `walletReads`, `socialReads`, `storeReads`, `packReads`, `tradeReads`, `realCollectionReads` | each `src/modules/<module>/wiring.ts` (`deckReads` alone has 25 members, from line 154 of `decks/wiring.ts`) | −400 to −700   |
| The service pass-through (17 services) and `Capabilities` entries that only forward                                                                                                                                                                    | `src/server/capabilities.ts` (`services`, 182 lines), `src/server/core.ts` (`services`)                      | −150 to −300   |
| `deckEdits` as the whole `Decks` service                                                                                                                                                                                                               | `decks/wiring.ts`, `index.ts` exports it needed                                                              | −50            |
| Reader types that only restate a query's signature                                                                                                                                                                                                     | each module's `application/ports.ts` / `wiring.ts`                                                           | −100 to −200   |
| Hand-written FormData parsing and session checks, in 27 files (`grep -rl "formData.get" src/app`)                                                                                                                                                      | `src/app/**/actions.ts` and `trades/new/draft-controls.tsx`                                                  | −300 to −450   |
| The 50-line error switch in `src/app/drafts/actions.ts` (line 42 on), and the same by hand in wishlist, trades, singles and cards                                                                                                                      | each `actions.ts`                                                                                            | −150 to −250   |
| `readPage()` calls inside FormData actions (84 `readPage(` in `actions.ts` files)                                                                                                                                                                      | `src/app/**/actions.ts`                                                                                      | included above |

## Touches

`src/server/{capabilities,core,page,page-instance,action,action-instance}.ts`, new
`src/server/{reads,form-action}.ts`, every `src/modules/<module>/{wiring,index}.ts`, the `queries/`
of every module, `src/modules/{reddit,youtube,reset}` (new `wiring.ts`), new
`src/modules/{drafts,wishlist,trades,store}/application/describe-error.ts` (and cards, singles
where missing), every `src/app/**/page.tsx` and `actions.ts`, `eslint.config.mjs`, new
`docs/design/67-read-layer.md`, `docs/adr/0026-capabilities-and-adapters.md`,
`tests/integration/access-rules.int.test.ts`. **Avoid** the page layout and components (P31, P32).

## Steps

1. **Design doc 67** (from `docs/design/TEMPLATE.md`) and an **ADR 0026 addendum.** Write down:
   - Three kinds of read, and who may call each:
     - **Player reads** take the signed-in `Actor` and filter by `actor.userId` **inside the SQL**.
       Their first parameter is `Actor`, never a plain `UserId` from the caller.
     - **Shared reads** (a shared deck, a public profile, the catalog) check visibility in SQL
       (shared with the playgroup, public link token) and say so in their name or folder.
     - **Admin reads** take the admin actor type, a distinct type that only the admin guard can
       produce.
   - How a page reaches them: `readPage()` returns `{ actor, capabilities, reads }`. `reads` is
     built once in `src/server/reads.ts`, binds `db` once (this replaces the `withDb` forwards), and
     is typed per module. Choose between a generic `bindDb(queries)` helper and plain functions; the
     doc says which and why. (Report 1's question: a newcomer should still be able to click
     through to the SQL.)
   - Which `Actor`-less routes exist (images, OpenAPI, tool endpoints, shared-deck tokens) and how
     `readCapabilities()` serves them without a player.
   - One table: every query, its kind, and the access rule a test pins.
2. **Types.** `Actor` already exists (`@/modules/accounts`). Add `AdminActor` (made only by the
   admin guard) and keep both un-constructible outside `src/server` (lint, or a branded type with a
   private constructor function).
3. **Move reads, one module per commit**, starting with the smallest (`activity`, `packs`,
   `inventory`, `wallet`), then `social`, `trades`, `wishlist`, `store`, `drafts`, `accounts`,
   `catalog`, `collection`, `real-collection`, and `decks` last. For each module:
   - Change its query functions to the three kinds above (add `Actor` where they took `userId`).
   - Switch every page and action that read through the old bundle to `reads.<module>.<query>`.
   - **In the same commit, delete the module's `*Reads` bundle and any reader type it made
     redundant.** A commit that adds a path and leaves the old one is not accepted.
4. **The pass-through.** For each of the 17 entries in `capabilities.services`:
   - If an adapter only reads, move it to `reads`.
   - If it writes or has rules, give it a narrow capability (only the methods the callers use) in
     the module's `wiring.ts`, and delete the whole-service entry.
   - `deckEdits` becomes the named edit capabilities the builder actually uses.
   - Delete `services` from `core.ts` when empty. `capabilities.ts` ends at or under 120 lines.
5. **Wiring for `reddit`, `youtube`, `reset`.** Each gets a `wiring.ts` with its `wire…Capabilities`
   factory (the P09b pattern), joined in `capabilities.ts`. `headerSummary` moves to
   a `site` capability or stays, whichever the design doc says; either way it reads through
   `reads`.
6. **`formAction`.** In `src/server/form-action.ts`, `formAction(schema, handler)`:
   - reads the FormData into an object (`Object.fromEntries`, with a rule for repeated keys and
     checkboxes written in the doc),
   - checks the session through the same path as `action()`,
   - parses with the schema, and on failure returns the issues as the form's error text,
   - calls the handler and turns `Result` errors into the form's message via the module's
     `describe-error`, then redirects or returns, as the action does today.
   - Unit-test it with fakes, like `action.test.ts`. Migrate the 27 files, one area per commit,
     deleting each file's hand-written parsing in the same commit.
7. **`describe-error` for the modules that lack one.** `accounts`, `catalog`, `decks`, `store` and
   `wallet` have it. Add it to `drafts`, `wishlist`, `trades`, singles and cards, moving the
   switch out of `app/**/actions.ts`. Each gets a test of the messages, like
   `decks/application/describe-error.test.ts`. Delete the switches.
8. **Access-rule tests.** `tests/integration/access-rules.int.test.ts`. For every player read and
   shared read in the design doc's table: another signed-in player gets "not found" or an empty
   result; a visitor gets nothing; a shared deck shows to the playgroup and a private one doesn't.
   Admin reads reject a plain player. One test per row; the table's row number goes in the test
   name.
9. **Lint.** In `src/app`, forbid importing `@/shared/db` and any module's `queries/` path, so
   pages and actions can only read through `reads`. Forbid a `queries/` function with a plain
   `userId: UserId` first parameter unless the table marks it as shared or internal (a
   `no-restricted-syntax` rule, or a unit test that scans exports).
10. Run `pnpm sizes --update`, record before and after in the handoff, and delete the rows this
    package closes from [removal-list.md](../removal-list.md).

## What not to do

- Don't leave a forward bundle "for later". It goes with its module's commit.
- Don't give a query a plain `userId` just because the caller has one.
- Don't change what the pages show. Behaviour stays as it is.
- Don't move modules or files (P18, P30). Don't add `paths.ts` or page states (P32).

## Done when

- `grep -rn "Reads:" src/modules/*/wiring.ts` finds nothing. `grep -c "services" src/server/capabilities.ts` is 0.
- `src/server/capabilities.ts` is ≤ 120 lines; `grep -rl "formData.get" src/app | wc -l` is 0 for
  action files (only `formAction` reads FormData).
- `grep -rn "getContainer\|@/shared/db" src/app | grep -v test` finds only the files on
  `CONTAINER_ALLOWED`, each with its reason.
- Every row of design doc 67's access table has a passing integration test.
- `pnpm check` and `pnpm test:int` are green, and the e2e suite passes (`pnpm test:e2e`, as it
  touches every page).
- The sizes baseline is lowered, and the handoff lists the deleted bundles and files, checked by the
  PM against the diff.

## Needs the owner

- Approve design doc 67 (the access-rule table and the shape of `reads`) before step 3. The plan
  fixes the direction (owner answer 3 a); the doc fixes the details.

## Handoff

### Part 1 (framework and the first eight modules; branch `refactor/P25a-read-layer`)

**Done.**

- `Actor` and `AdminActor` are branded (`accounts/domain/player.ts`). `toActor` and `asAdmin` are the
  only makers. `asAdmin` is a method of the accounts service, called only by `server/session.ts`.
  `testActor()` / `testAdminActor()` (`accounts/testing/actors.ts`) replace the 16 test literals.
  Lint bans `as Actor` / `as AdminActor` outside tests, `testing/` and `player.ts`
  (`FORGED_ACTOR` in `eslint.config.mjs`).
- `bindDb` and `bindPublicDb` (`shared/db/bind-db.ts`) with the `Refusing` type check (a first
  parameter of `UserId` fails to compile; a visitor read also refuses `Actor`).
  `src/server/reads.ts`: `buildReads`, `buildPublicReads` (empty: no moved module has a token read),
  `Reads`, `PublicReads`. `readPage()` and `action()` hand over `reads`; `readPage({ admin: true })`
  returns an `AdminActor`; `readPage({ allowVisitors: true })` is a union that narrows on `actor`
  even when destructured (type test in `page.test.ts`). `readTool(request)` in
  `server/read-tool.ts`; `ToolContext` is now `ToolRequest`.
- `formAction` (`server/form-action.ts`, `form-action-instance.ts`): list fields by `getAll`,
  `checkbox()`, `blankAsUndefined()`, session check, `{ admin: true }`, `FormState`, tests with
  fakes. **Not migrated.** A `FormRunner` is not assignable to `<form action>`'s
  `(formData) => void | Promise<void>` (it returns `Promise<FormState>`), so forms use
  `useActionState`, or a form that always redirects needs a small wrapper.
- Moved, one commit each, `*Reads` bundle deleted in the same commit: activity, packs, inventory,
  wallet, social, trades, wishlist, store. Files deleted: `activity|packs|inventory|wallet|social|trades|store/wiring.ts`
  (wishlist's `wiring.ts` stays: it holds `wishlistView`, `addWishes`, `removeWishes`).
- `/api/artwork` returns 401 without a real session (F10). `/api/images` stays public.
- `tests/integration/access-rules.int.test.ts`: R5, R51-R55, R66-R97 (written, not run).

**Convention for part 2.** A module's `queries/index.ts` is `export * from "./file"` for each file
of public reads, and the module `index.ts` has `export * as <module>Queries from "./queries"`.
`export *` (not `export { x as y }`) is what makes Go to Definition on `reads.m.q` land on the SQL
function. So the function's own name is the read's name (`feed`, `history`, `view`). Helpers that must
not become reads live in a file `queries/index.ts` does not list (`for-sale.ts`, `of-user.ts`,
`pack-msrp.ts`). Admin reads take `AdminActor` as the second parameter (unused: the type is the rule).

**Numbers.** Production code lines 74,789 to 74,895 (+106): the framework is added first and part 2
removes the services, `withDb`, `deckEdits`, the other six bundles and the form parsing. The sizes
baseline was NOT lowered, and `pnpm check` fails on `sizes` until the owner approves this growth or
part 2 lands. Knip: 457 to 428 (the baseline is lowered). To get there `knip.json` ignores
`form-action*.ts`, the eight moved modules' `queries/*.ts` exports (knip can't follow
`Object.entries(namespace)`) and `bind-db.ts` exports; see removal-list.md.

**Left for part 2.**

- Modules: drafts, accounts, catalog, collection, real-collection, decks. Six bundles remain
  (`grep -rn "Reads:" src/modules/*/wiring.ts`). Move them, then delete `withDb`/`WithoutDb`.
- Fill `PublicReads` (accounts.hasAnyPlayers, decks.publicDeck, publicScorecard,
  publicDeckTokens(token)) with `bindPublicDb`; delete the knip ignore for it.
- Replace `wishlist/queries/of-user.ts` once `getAccountOverview`, `wishlistView` and `lookUpCards`
  take an `Actor` (F7); the same for `refreshWallet`, `deckOverview`, `checkOwnedCards`.
- `trades/new/page.tsx` still calls `collection.page(partner.userId, ...)` (F5): make it
  `collection.pageOfPartner(actor, partnerId)`.
- The 17 services, `capabilities.ts` at or under 120 lines, `describe-error` files, migrating the
  27+ form files to `formAction`, the final lint rules (no `@/shared/db` or `queries/` in
  `src/app`), the `NoPlainUserId`-style check for the remaining modules (already enforced by
  `bindDb` when a module is added to `buildReads`).
- Drafts page `loreSources` now takes `reads` and `actor`; keep it that way.

### Part 2b (the other six modules; same branch, commits `P25b:`)

**Done.**

- Moved, with the module's `*Reads` bundle deleted in the same commit: drafts, accounts,
  collection, real-collection, catalog, decks. `reads` now has all 14 modules' reads
  (`src/server/reads.ts`). `withDb` and `WithoutDb` are deleted. `drafts`, `collection` and the
  accounts/catalog/real-collection `wiring.ts` files are gone (`catalog/wiring.ts` too:
  `printingDetails` moved into `capabilities.ts`); `accounts/wiring.ts`, `decks/wiring.ts` and
  `wishlist/wiring.ts` stay for their non-read capabilities.
- `PublicReads` is filled with `bindPublicDb`: `accounts.hasAnyPlayers`, `decks.publicDeck`,
  `decks.publicScorecard`, `decks.publicDeckTokens(token, makers)`. `Reads` also contains them
  (a signed-in player opens `/d/[token]` too), so `reads.decks.publicDeck` works for both sides of
  the `readPage({ allowVisitors: true })` union.
- Security fixes (what another player sees, and any change to it):
  - **F1** `realCollection.page`, `sets` and `productsOf` take `(actor, ownerId)` and check
    "yours, or the owner shares" in SQL. Before: the page checked. After: same visible result.
  - **F2** `decks.deckComments(actor, deckId)` joins `decks`: a private deck's comments are `[]`
    to everyone but the owner. Before: the page checked first. Same visible result.
  - **F3** `decks.publicDeckTokens(token, makers)` finds the deck by its link token; a wrong or
    revoked token gives no tokens. Before: any deck number worked (not reachable).
  - **F4** drafts stay visible to every signed-in player; `drafts.version(actor, draftId)` takes
    the `Actor` (the same rule as `view`). No change for players.
  - **F5** `collection.pageOfPartner(actor, partnerId)` is the one named way to read another
    player's game collection (the owner's choice). It gives an empty page for yourself, a disabled
    player or an unknown id; the trade builder showed exactly the active partners before.
  - **F6** `deckForViewer` and the deck page's non-owner overview test visibility in SQL
    (`owner or visibility = 'shared'`); `canViewDeck` stays for the capabilities and the
    access-rules test checks that both agree. The `social` and `wishlist` ones were done in part 1.
  - **F7** `refreshWallet`, `getAccountOverview`, `wishlistView`, `lookUpCards`, `searchCatalog`,
    `deckOverview` and `checkOwnedCards` take an `Actor`. `deckOverview(actor, { deckId, asViewer })`:
    the shared-deck page passes `asViewer: true` (own deck, or a shared one, checked in SQL);
    tools never do. `wishlist/queries/of-user.ts` is deleted.
  - **F8** `catalog.searchPrintings(actor, search)`: the `own` counts come from the actor, not
    from a field of the input.
- Every read has a row in `tests/integration/access-rules.int.test.ts` (R1-R4, R6-R50 and R56-R65
  new; 79 tests in the file; the run was green on this machine for that one file).

**Shapes worth knowing.**

- `decks/queries/reads.ts` holds the 17 player reads as thin `(db, actor, ...)` wrappers over
  queries that still take a `userId`: the capabilities in the same module call those with the
  actor's id (design doc 67, section 7B), and about 60 integration test call sites use them. P18
  (the decks split) can fold the wrapper and the query into one. `decks/queries/index.ts` lists the
  other reads by name, not `export *`, because `sharing.ts` and `tokens.ts` also hold
  userId-based helpers. Whether "Go to definition" passes through a named re-export is **not
  checked**.
- `catalog` helpers that are not reads (`printing-cards.ts`, `pack-key.ts`, `rules.ts`,
  `store-printings.ts`) sit outside `queries/index.ts`; so does `real-collection`'s
  `printing-ids.ts`. `collection.ownedByOracle` and `realCollection.ownedByOracle` are public P
  reads (they take the actor) rather than the "internal" reads of section 7B.
- R7: `catalog.findSet` does not hide a disabled set (the opened-pack page names such sets), so the
  doc's R7 rule "a disabled set is hidden" is not what the code does; the test pins what it does.
- `/api/export/*` takes `rowsOf(reads, actor)`.

**Numbers.** Production code 74,895 (end of part 1) to 74,868, which is 79 over the baseline
(74,789); the baseline was not lowered because it is not below. Knip 428 to 396 (baseline lowered);
the `bind-db.ts` knip ignore is gone. Clone baseline 25 to 22 (lowered).

**Left for part 2c.** The 17 services in `capabilities.services` and the `deckEdits` pass-through,
`capabilities.ts` at or under 120 lines, the `describe-error` files, migrating the form files to
`formAction`, the final lint rules (no `@/shared/db` or `queries/` in `src/app`). `printingDetails`
and `headerSummary` still live in `capabilities.ts`. Pages still read `capabilities.printingDetails`
(14 call sites) beside `reads`.

### Part 2c (services, describe-error, forms, lint; same branch, commits `P25c:`)

**Done.**

- **The 17 services are narrow capabilities, one module per commit, each deleting its whole-service
  entry.** `capabilities.services` and `services:` in `core.ts` are gone; `grep -c services
src/server/capabilities.ts` is 0; `capabilities.ts` is 106 lines (was 161). It lists the
  services it is handed, calls each module's `wire…Capabilities` and spreads the results.
  `core.ts` passes the services straight in. Helpers: `pick(service, ...names)`
  (`shared/kernel/pick.ts`) and `pickForAdmin(service, ...names)` (`accounts/domain/player.ts`):
  the second types each method's first parameter as `AdminActor`.

  | Service                                                 | Now                                                                                                                                                                                                   |
  | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `packs`                                                 | `packs/wiring.ts`: `simulateOpenings` (AdminActor)                                                                                                                                                    |
  | `inventory`                                             | `inventory/wiring.ts`: `openItem`, `openAll`                                                                                                                                                          |
  | `wallet`                                                | `wallet/wiring.ts`: `refreshWallet`, `addOwnFunds`; AdminActor: `grantMoney`, `correctBalance`, `updateEconomySettings`, `refreshAllWallets`                                                          |
  | `social`                                                | `social/wiring.ts`: 6 methods (all of them)                                                                                                                                                           |
  | `trades`                                                | `trades/wiring.ts`: 5 methods (all of them)                                                                                                                                                           |
  | `wishlist`                                              | `wishlist/wiring.ts`: 6. `addWish`/`removeWish` stay beside `addWishes`/`removeWishes`: they are not duplicates (typed form input vs the model's batch with its own sentences), so nothing was merged |
  | `realCollection`                                        | `real-collection/wiring.ts`: 8                                                                                                                                                                        |
  | `store`                                                 | `store/wiring.ts`: `buySingle`, `sellSingle`, `buySealed`, `buyList`; AdminActor: the 4 price settings                                                                                                |
  | `drafts`                                                | `drafts/wiring.ts`: 17 (not `runTimers`: the worker holds the service)                                                                                                                                |
  | `catalog`                                               | `catalog/wiring.ts`: `imageFor`, `artworkFor`; AdminActor: `choosePhoto`, `clearPhotoChoice`, `enableStandardSets`, `requestSync`, `setPageSlug`, `setSetEnabled`. `printingDetails` moved here       |
  | `accounts`                                              | `accounts/wiring.ts`: 10 plus AdminActor: `createInvite`, `revokeInvite`, `setAdmin`, `setDisabled`, `setSelfFunding`, `resetPassword`                                                                |
  | `deckSharing`, `chooseToken`, `proxySheet`, `deckEdits` | `decks/wiring.ts`: `deckSharing` (6), the two functions, `deckEdits` = the 19 builder methods                                                                                                         |
  | `resetPlayer`                                           | `reset/wiring.ts` (new)                                                                                                                                                                               |
  | `reddit`, `youtube`                                     | their own `wiring.ts` (new)                                                                                                                                                                           |
  | `seeds`, `appUrl`, `headerSummary`                      | `site.newSeed()`, `site.appUrl`, `site.headerSummary(actor)` in `src/server/site.ts`; the four counts come from `reads`                                                                               |

  `rulesLookup`, `lookUpCards` and `searchCatalog` (the cross-module ones) moved to
  `src/server/lookups.ts` and take their readers from `reads`.

- **`describe-error`** added for drafts (`describeDraftError`), wishlist (add, update, buy), trades
  (propose, decide) and, in the existing store file, singles and cards (`describeBuySingleError`,
  `describeSellSingleError`, `describeBuyListError`), each with a messages test. The switches left
  `app/drafts`, `app/wishlist`, `app/trades`, `app/cards/[id]` and `app/singles/list`.
- **`formAction` forms** (each keeps its messages and redirects; the components take `FormState`
  and start from `{ message: null, tone: null }`): wallet add funds, store buy, account start
  over, admin economy, admin money, admin reset library, card page buy and sell, admin catalog
  sync and "enable Standard". `formAction` gained `invalidInput` (the form's own sentence when the
  schema rejects) and `FormState` is a union, so `state.message &&` narrows `tone`. The admin
  overload is listed first, or an `admin: true` form was typed with a plain `Actor`.
- **Lint:** in `src/app` (components included, tests excepted), `@/shared/db`, `@/shared/card-search/sql`
  and any `@/modules/<m>/queries…` are `no-restricted-imports` errors (boundaries already refused
  them; now the message says why). The `UserId`-first check is `bindDb`'s compile-time one,
  unchanged. The `form-action*` knip ignore is gone.

**Kept as they were (the old behaviour can't be kept through `formAction` as it is).**

- Forms that `redirect` with `?error=`/`?message=` on a plain `<form action>`: drafts, decks
  (all), decks/commanders, trades, inventory open, admin store, admin photos, collection/real,
  wishlist remove and sharing. `formAction` returns a state and a `<form action>` can't take one.
  Wrapping each in a redirecting function would also change what an unreadable form does (today a
  silent redirect, then the issues text).
- Forms with their own state: sign-in and register (keep the typed values), change password (needs
  `allowPasswordChangePending`, which `formAction`'s session check lacks), tokens (shows the secret
  once), admin players actions (temporary password), admin invites create (the link), profile,
  edit-as-text, OAuth approve.
- Wishlist add, update, buy and "wish for short cards": the old code gives a different sentence for
  a bad request than for a bad quantity, and `RequestForm` is a discriminated union
  (`formAction` takes a `z.object`). A single `invalidInput` would merge the sentences.
- The silent plain forms (friends, revoke token, revoke invite, set-set-enabled): void actions.
- `grep -rl "formData.get" src/app` still lists 20 action files and 1 component.

**Numbers.** Production code 74,868 to 75,151 (+362 over the baseline of 74,789; was +79). The
wiring files, `pick`, `site.ts` and `lookups.ts` add about 280 lines; the services type, the old
`headerSummary` and the old arguments in `core.ts` take away about 60; the migrated forms are
level (a schema, the same messages and a handler replace the same parsing). The baseline was not
lowered. Knip 396 to 391 (baseline lowered). Clones 22 to 21 (lowered). The `queries/*.ts` knip
ignore stays: without it 100 findings return.

**Not checked.** `next build` can't run in the agent's worktree (Turbopack rejects the
`node_modules` symlink), so `export const x = formAction(...)` in a `"use server"` file was not
compiled by Next (next-safe-action does the same). No e2e run. The PM should open the wallet,
the store, "start over", the card page and the admin economy, money, reset and catalog pages in the
browser.

### P25 as a whole

Reads: 14 `*Reads` bundles and `withDb` are gone; `reads.<module>.<query>` binds `db` once with
`bindDb`, a per-player read takes the `Actor` and filters in SQL, a visitor gets `PublicReads`.
Capabilities: every one of the 17 services is narrow, admin methods take `AdminActor`, and
`capabilities.ts` only joins the module wirings. 97 reads and the 10 security findings are covered
by `access-rules.int.test.ts`. `describe-error` exists for every module whose forms show errors.
Not met: the line count (+362, the plan's -1,100 to -1,800 assumed the services and the form
parsing would shrink; the pass-through was about 60 lines and a schema plus handler is as long as
the parsing it replaces), and 20 action files still read FormData.
