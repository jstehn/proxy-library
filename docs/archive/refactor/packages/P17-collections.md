# P17. One way to show a collection

- **Branch:** `refactor/P17-collections` · **Depends on:** P09c · **Parallel with:** P15, P16
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

**Done.** Shared SQL: `src/shared/card-search/sql-collection.ts` (`readCollectionPage`,
`readCopiesOf`, `readOwnedByOracle`, `readCollectionExport`, taking a `CopiesSource` = the table plus
three arrival-time SQL fragments). Each module owns its source: `GAME_COPIES` in
`collection/queries/collection.ts`, `REAL_COPIES` in `real-collection/queries/real-collection.ts`.
The shared file names neither table. The lint selector `cardSearchSql` now matches `sql*.ts` so
the new file gets the same rules (an adapter can't import it, it may read `shared/db`). The rule
"only `decks` reads `real-collection`" is unchanged and still passes.
UI: `src/app/collection/{card-grid.tsx,collection-query.ts}` (one grid with an optional `noteFor`,
`ExportLinks`, and the address-to-filter reader used by three pages), `src/ui/collection/options.ts`
(sorts, sections, finish names; moved from `app/collection/shared.ts`). The grid and the query
reader can't live in `src/ui/`: lint lets `ui` import only `ui` and the kernel, and they need
`CardTile`, `card-filters` and module types from `app/`.
Export: `src/app/api/export/collection-download.ts`, one handler; the two routes are 8 lines each.

**Real differences kept** (data in each module's source): the table; "newest first" is the newest
acquisition (game) or `added_at` (real); export first/last acquired are the first/last acquisition
(game) or `added_at`/`updated_at` (real). Pages: game shows "In: <decks>" notes, a catalog set list,
and a store link in the empty state; real has import, products, sharing settings, clear, a message
alert, and a different empty state. Other quirks removed: the real page row's unused `oracleId`,
the unused `OwnedCard` type, and `RealExportRow` (now the shared row type).

**Behaviour notes.** Unchanged SQL text except: table name and arrival columns now come from the
source; `readCopiesOf` is raw SQL instead of a drizzle select (same rows); the real page runs its two
queries in parallel (game already did); real "newest" sorts `nulls last` (never null there).
Integration tests that cover the changed SQL: `singles.int.test.ts` (collectionPage),
`real-collection.int.test.ts`, `card-search.int.test.ts`. See `deferred-checks.md` for the rest.

**Sizes.** Source lines 92,917 → 92,834 (−83; code lines 79,672 → 79,552, −120). Missed the −300 to
−450 target: the two query files were near-copies, but the pages differ more than the audit counted
and the shared files add their own types and docs. Clone runs 36 → 25 (baseline lowered).
