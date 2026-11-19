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

- Nothing under `src/app/{decks,drafts,collection,d,cards,inventory}` calls `getContainer` or
  imports a query (except files in `CONTAINER_ALLOWED`, each with a reason).
- `decks/actions.ts` ≤ 200 lines. `drafts/actions.ts` and `collection/real/actions.ts` are shorter
  (record before and after).
- The `decks/index.ts` export count is lower than P09b's handoff number.
- `pnpm check` and `pnpm test:int` are green. Run the e2e suite (`tests/e2e/accounts.spec.ts` holds the deck, draft and collection flows).
- Deferrals go into the receiving package's file in the same commit.

## Handoff

(empty)
