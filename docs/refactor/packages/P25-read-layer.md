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
