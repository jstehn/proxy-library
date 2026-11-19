# P09b. Capability wiring per module; builder actions through `action()`

- **Branch:** `refactor/P09b-wiring` · **Depends on:** P09 · **Parallel with:** none (it sets the
  pattern P09c and P09d copy)
- **Audit:** [milestone 1 review](../reviews/milestone-1.md), findings 1–4
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1)
  (the "UI caller" column) · **Lines to remove:** about −500 to −900 (low confidence)

## Why

Wave 2 built capabilities and moved the LLM tools onto them, but every server action and page still
reads through `getContainer().db` and the old query functions. The second copy only goes away when
the UI calls the capabilities too. This package builds the three pieces the UI needs, then moves the
biggest caller, `builder/actions.ts` (756 lines, 30 `getContainer()` calls).

## Touches

`src/server/{capabilities,action-instance,container}.ts`, new `src/server/page.ts`,
`src/modules/{decks,catalog,collection,real-collection,wishlist,accounts}/{index,wiring}.ts`,
`src/app/decks/[id]/builder/actions.ts`, `eslint.config.mjs`, ADR 0026.
**Avoid:** builder components (`*.tsx` in `builder/`, P19), other `actions.ts` files (P09c, P09d).

## Steps

1. **Wiring per module.** For each module that `capabilities.ts` reaches into, add
   `src/modules/<module>/wiring.ts`, exporting one factory such as
   `wireDeckCapabilities(dependencies)`. It takes `{ db, clock, … }` plus ports from other modules
   and returns that module's capabilities.
   - Move the module's block out of `src/server/capabilities.ts` into that factory, unchanged.
   - Inside it, write each repeated reader once: `const readDeck = (userId, deckId) => deckView(db,
userId, deckId)`, and the same for `profile` (repeated 6 times today).
   - `capabilities.ts` then only calls each `wire…Capabilities` and spreads the results. Target:
     under 120 lines.
   - Lint: `wiring.ts` may import its own module's `queries/`, `application/` and `infrastructure/`.
     Only `src/server/**` and `worker/**` may import a `wiring.ts`. Add both rules to
     `eslint.config.mjs` beside "Adapters stay thin".
2. **A page helper.** Add `src/server/page.ts` with `readPage()`, returning
   `{ actor, capabilities }` (or `{ actor: null, … }` for a page that allows visitors). This is
   `action()`'s twin for server components and routes. Give it a unit test with fakes, like
   `action.test.ts`.
3. **Amend ADR 0026.** Point 1: capabilities are wired per module in `wiring.ts` and joined in
   `src/server/capabilities.ts`. Point 2: pages (`page.tsx`) are a fifth adapter kind, reading
   through `readPage()`. Point 5: this package and P09c/P09d move the callers (not "P06–P09").
   Add a change-log line.
4. **The ratchet.** In `eslint.config.mjs`, extend "Adapters stay thin" to
   `src/app/**/{page.tsx,route.ts,layout.tsx}`. Add a `no-restricted-syntax` rule banning
   `getContainer` everywhere in `src/app`:
   - Selector: `CallExpression[callee.name='getContainer']`, with the message "Call
     capabilities through action() or readPage() (ADR 0026)".
   - Every file that still calls `getContainer` today goes into a constant `NOT_YET_ON_CAPABILITIES`
     (a sorted list of paths) in `ignores`. Generate the list with
     `grep -rl 'getContainer()' src/app | grep -v _llm-tools | sort`.
   - The list only shrinks: each package deletes the paths it moved. Exceptions are files that
     must keep it, such as `_oauth/http.ts` and `api/health/route.ts`, each with a reason comment.
     Those go in a separate `CONTAINER_ALLOWED` list.
5. **Builder actions.** Rewrite each action in `builder/actions.ts` as
   `export const xAction = action(XInput, async ({ actor, capabilities }, input) => …)`.
   - For each one, find the capability that already answers it. Use the table in
     [S1](../dedup-playbook.md#s1); for example, `browseAction` maps to `deckSearch`, `similarAction`
     to `replacements.similarTo`, and `deckSuggestions` to the suggestion service.
   - Where none exists, write it in the module's `application/` (a `make…` factory with a fake test),
     not in the action.
   - Pages calling a changed action must handle the `Result` (`InvalidInput`). Keep the messages the
     builder shows today: use `describeDeckError`, and show an `InvalidInput` result's `issues`.
   - Remove `builder/actions.ts` from `NOT_YET_ON_CAPABILITIES` and from the oversize allowlist.
6. **Shrink `decks/index.ts`.** Every export that only the builder used, and that `wiring.ts` now
   imports directly, leaves `index.ts`. Check with `grep -rn "<name>" src worker` before deleting each
   one. Record the export count before and after (`grep -c '^export' src/modules/decks/index.ts`,
   96 today).

## What not to do

- Don't change what an action returns to the browser. The builder components are P19's; if a type
  has to change, keep the old shape in the action's `present` step.
- Don't merge two capabilities because they look alike. Use the same-job test (playbook A1, step 3).
- Don't add `getContainer` back to make something compile. Put the path on the list instead and say
  so in the handoff.

## Done when

- `src/server/capabilities.ts` is under 120 lines, and every module block lives in its `wiring.ts`.
- `readPage()` exists and is tested. ADR 0026 is amended.
- The ratchet lint rule is on, and `NOT_YET_ON_CAPABILITIES` no longer lists `builder/actions.ts`.
- `builder/actions.ts` is ≤ 350 lines, with no `getContainer`, `db` or query import.
- `decks/index.ts` has fewer exports than 96 (record the number).
- `pnpm check` and `pnpm test:int` are green. The builder tests in the e2e suite pass:
  `pnpm test:e2e tests/e2e/accounts.spec.ts -g deck` (the deck flows; no test name says "builder").
- **Deferrals** go into P09c, P09d or P19's file (Steps and Done when) in the same commit, not only
  into this handoff (README, "Ending a session").

## Handoff

(empty)
