# P17. One way to show a collection

- **Branch:** `refactor/P17-collections` · **Depends on:** P09 · **Parallel with:** P15, P16
- **Audit:** doc 65 D10
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S5](../dedup-playbook.md#s5) (collections, exports, pages) · **Lines to remove:** about −300 to −450

## Goal

The game collection and the real collection share their display code (queries, pages, export).
Their tables, and the rule that the real collection never touches the game, stay as they are.

## Touches

`src/modules/collection/queries/collection.ts`, `src/modules/real-collection/queries/real-collection.ts`,
`src/app/collection/page.tsx`, `src/app/collection/real/page.tsx`,
`src/app/api/export/{collection,real}/route.ts`, new shared code in `src/ui/collection/` (and,
for SQL, a helper that takes the table as a parameter, wherever ADR 0009's rules allow:
`catalog` or `shared/db`).

## Steps

1. Diff each pair (today: 119 shared lines in the queries, 81 in the pages, 21 of 27 in the export
   routes). List the real differences (filters, columns, actions).
2. Extract the shared parts with the source as a parameter. The differences stay in each module.
3. Check the boundary lint still enforces that only `decks` reads `real-collection`.

## Done when

- The clone report no longer pairs these files.

## Handoff

(empty)
