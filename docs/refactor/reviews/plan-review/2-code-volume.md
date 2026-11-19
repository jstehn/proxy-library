# Plan review 2: where the code volume is, and whether the plan delivers

A read-only review by an agent, on `refactor/main` at `48f18af`, 2026-11-19.

## What it measured

**Totals.** 79,560 code lines. About 2,400 of them are test support inside `src` (`testing/` fakes
and fixtures), which still counts toward the target.

**Biggest areas (code lines):**

| Area              | Code lines | Biggest parts                       |
| ----------------- | ---------- | ----------------------------------- |
| `src/app`         | 25.9k      | `app/decks` 9.7k, `_llm-tools` 3.6k |
| `modules/decks`   | 19.5k      | domain 10.1k, queries 4.7k          |
| `modules/catalog` | 6.5k       |                                     |

**Types.** About 8,600 lines are type declarations. `typeLine: string` is declared again in 51
places, and knip reports 439 exported types as unused.

**Duplication.**

- **Exact clones:** only 25 runs, a few hundred lines in all.
- **Near-clones** (ignoring names and literals, in 8-line windows): about 3,500 lines, of which
  about 400 to 600 can go.

**Unreachable from production code** (`knip --production`): about 600 to 900 lines.

| Code                                                                               | Lines     | Notes                  |
| ---------------------------------------------------------------------------------- | --------- | ---------------------- |
| `mulligan-trainer.ts`                                                              | 118       | no production importer |
| `decks/domain/packages.ts`                                                         | 110       | no production importer |
| `decks/queries/packages.ts`                                                        | 18        | no production importer |
| `catalog/client.ts`                                                                | 3         | no production importer |
| `eval.ts`                                                                          | 96        | used only by a script  |
| `deckUpgradeRoadmap`                                                               | about 230 | no caller              |
| `deckCombosView`                                                                   | 66        | no caller              |
| `actFor`, the `draws.ts` odds helpers, `TtlCache`, the `fixture*Gateway` functions | about 250 | used only by tests     |

**Ports.** 17 `ports.ts` files, about 1,400 lines. Each has one Drizzle adapter and one in-memory
fake, and every one is used by tests.

**Form actions.** 82 FormData actions, each hand-writing its session check, redirect and error
text. `drafts/actions.ts` still has its own 50-line error switch.

**Ceremony.** For example, `deck-signals.ts` is 43 lines wrapping 2 lines of logic.

## Why packages grew

Comments aren't the cause: about 8% of lines are comments in the files the refactor touched, the
same as everywhere else. The causes are:

- A new layer was added beside the old one, and the old code stayed as its implementation.
- Splitting files adds ceremony: imports, prop types and action types.
- Estimates were made top-down, with no list of what would be deleted.
- Regexes moved into new homes rather than being deleted.

## Ranked savings

| #   | What                                                                                  | Lines          |
| --- | ------------------------------------------------------------------------------------- | -------------- |
| 1   | Delete code production can't reach (owner confirms each item)                         | −600 to −900   |
| 2   | Collapse capability scaffolding: forward bundles, service pass-through, readers types | −500 to −900   |
| 3   | Shared card and row types instead of 51 copies of `typeLine`                          | −300 to −500   |
| 4   | A `formAction` helper, and `describe-error` for the remaining modules                 | −300 to −450   |
| 5   | Near-clones                                                                           | −400 to −600   |
| 6–9 | P15, P13, P12, P14 (about 40% below the plan's own estimates)                         | −450 to −1,050 |
| 10  | P11                                                                                   | +300 to +600   |

## Projection

| Plan                   | Net change       | Ends at                |
| ---------------------- | ---------------- | ---------------------- |
| As written             | −500 to −1,700   | about 77,900 to 79,000 |
| With rows 1 to 5 added | −2,500 to −4,500 | about 75,000 to 77,000 |

**Reaching 73,000** needs about −6,500. That means cutting dead features, moving the `testing/`
lines out of the count, or collapsing rows 2 and 3 harder.

## Process changes it suggests

- A code-line ratchet in `pnpm check`. A package that grows the count needs an approved reason.
- A package lists the paths it will delete before it's approved.
- A near-clone check that ignores names and literals.
- `knip --production` in the merge gate.
- A commit that adds a capability deletes the old path in the same commit.
- A new layer states its cost and which package pays it back.
