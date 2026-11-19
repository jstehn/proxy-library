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

(empty)
