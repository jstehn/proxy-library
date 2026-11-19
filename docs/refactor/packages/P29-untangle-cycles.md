# P29. Untangle the import cycles before the split

- **Branch:** `refactor/P29-untangle` · **Depends on:** P15, P27, P28 (milestone 2 passed) · **Parallel with:** none
- **Source:** [plan review](../reviews/plan-review/README.md) (P29), reports [1](../reviews/plan-review/1-architecture.md) and [4](../reviews/plan-review/4-domain-engines.md)
- **Lines:** small. A net of about −50 to 0; each moved type and each broken cycle should not add code.

## Why

P18 splits `decks` into subfolders that import each other only through each subfolder's
`index.ts`. Cycles inside `decks` would make that impossible, so they are broken first. Today
`pnpm lint:cycles` (`scripts/check-cycles.ts`) looks at files and ignores `import type`, so type
cycles between folders pass, and nothing checks cycles between **modules**.

## Deletes

| What                                                                                                                                                                                                                    | Where                                                                                                                                                | Lines      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The duplicated `ProfileLine` import paths: `ProfileLine` moves from `suggest.ts` to `stats.ts` (next to `StatsLine`); the re-exports and imports through `suggest.ts` go                                                | `decks/domain/suggest.ts` (line 28), and importers `cuts.ts`, `mana-base.ts`, `draft-deck.ts`, `suggestion-types.ts` (verify: `eval.ts` went in P24) | −10 to −30 |
| The `castability` ↔ `mana-base` type cycle: `mana-base.ts` imports `CastabilitySummary` from `castability.ts`, which imports `tapped` from `mana-base.ts`. Move `tapped` (or the summary type) to the file that owns it | `decks/domain/{castability,mana-base}.ts`                                                                                                            | −5 to −20  |
| The `suggest` ↔ `suggestion-types` cycle                                                                                                                                                                                | `decks/domain/{suggest,suggestion-types}.ts`                                                                                                         | −5 to −20  |
| The `accounts` ↔ `decks` cycle (`accounts/wiring.ts` imports `decks`; `decks` imports `accounts` in 17 files, mostly for `Actor` and `UserId`)                                                                          | `accounts/wiring.ts`, `decks/**`                                                                                                                     | −10 to −30 |
| `audit-report.ts` importing the play types, and the `deck-view.ts` / `preview.ts` imports of `EdhrecSignal` from `suggest`                                                                                              | `decks/domain/{audit-report,deck-view,preview}.ts`                                                                                                   | small      |

Also check `catalog` ↔ `accounts` (`catalog/application/admin.ts` imports accounts; accounts imports
catalog) and `drafts` → `decks` (7 places) / `decks` → `activity`. Fix them only if the new check
(step 1) reports a cycle.

## Touches

`scripts/check-cycles.ts` and its test, the files above, `eslint.config.mjs` (only if a boundary
rule changes), `docs/refactor/` (a new `module-cycles-baseline.txt`).

## Steps

1. **A module-level cycle check first.** Extend `scripts/check-cycles.ts` with `--modules`:
   - Nodes are modules (`src/modules/<name>`), and, inside `decks`, the four planned areas
     (play, advice, proxies, core, by file name list in a table at the top of the script: write
     it from the cluster map in [report 4](../reviews/plan-review/4-domain-engines.md)).
   - Edges come from **all** imports, including `import type` and the module `wiring.ts` files
     (`wiring.ts` is exempt from the layer rules, which is how cycles slip in).
   - It reports cycles, and compares with `docs/refactor/module-cycles-baseline.txt` (a list of
     known cycles). A new cycle fails. `--update` only removes entries from the baseline. Same
     idea as the clone baseline.
   - Add it to `scripts/check.sh` (`cycles` runs both modes). Unit-test it on a small graph.
2. **Record the baseline** (every cycle it finds today). This is your worklist; the list should
   reach zero in this package.
3. **Break the cycles, one per commit,** each commit deleting its baseline entry:
   - Move `ProfileLine` to `stats.ts`. Import it from there. Remove the `suggest.ts` export if
     nothing else needs it.
   - `castability` ↔ `mana-base`: find which of the two types or functions is used by both and
     move it to the file that owns it, or to a third small file (`mana-types.ts`) only if the two
     files both need more than one thing.
   - `suggest` ↔ `suggestion-types`: types go in `suggestion-types.ts`; `suggest.ts` imports them,
     not the reverse.
   - `accounts` ↔ `decks`: `decks` should import `Actor` and `UserId` from `@/shared/kernel` or
     from a type-only `accounts/index.ts` entry; `accounts/wiring.ts` should receive what it
     needs from `decks` as arguments (`dependencies`), not import it. Pick whichever deletes more.
   - The rest the check reports.
4. `audit-report.ts` imports play types: move the type the report needs to the file that owns it,
   or into `stats.ts`, so `core` no longer imports `play`.
5. Run `pnpm check`. Run `pnpm sizes --update` if lines fell.

## What not to do

- Don't hide a cycle by turning an import into `import type`. The new check counts types.
- Don't create a "types" dumping file. A type goes to the file whose concept it is.
- Don't move files between folders (P18).

## Done when

- `pnpm lint:cycles` runs both modes and `docs/refactor/module-cycles-baseline.txt` is empty.
- `grep -rn "ProfileLine" src/modules/decks/domain/suggest.ts` shows no definition.
- `pnpm check` is green. The handoff lists each cycle, how it was broken, and the line change.

## Handoff

(empty)
