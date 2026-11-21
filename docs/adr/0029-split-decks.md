# 0029. `decks` is one module with responsibility subfolders

- **Status:** Proposed (the owner confirms the area names; refactor P18, decisions 4 and D4)
- **Date:** 2026-11-20
- **Extends:** 0001, 0016

## Context

`src/modules/decks` held 174 files in four layer folders (`domain` 46 source files, `application`
30, `queries` 28, `infrastructure` 8). Nobody could say what it was for: deck lists, suggestion
scoring, the deck builder, the goldfish simulator and the proxy PDFs all sat side by side. Decision
4 chose one module over four (they share tables, ports and the `Deck` type). Decision D4 chose to
split advice into scoring and building so no folder passes 12 source files. P29 first broke the
import cycles that made a split impossible.

## Decision

`decks` stays one module. Inside it, each **area** is a folder with the usual layer folders
(ADR 0001) and its own public API.

| Area       | Source files (domain / application / infrastructure / queries / testing) | What it holds                                                                                                                               |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`     | 20 / 20 / 4 / 8 / 2                                                      | the deck itself: lists, legality, formats, brackets, headings, boards, stats, snapshots, change previews, sharing, the repositories (ports) |
| `scoring`  | 7 / 1 / 0 / 1 / 0                                                        | rating and ranking cards for a deck: `rate`, `signals`, `suggest`, `cuts`, `swaps`, `replacements`, `optimize`                              |
| `building` | 7 / 3 / 0 / 11 / 0                                                       | making a deck: `build-from-collection`, `mana-base`, commanders, candidate pool, suggestion orchestration, audit report                     |
| `play`     | 7 / 1 / 0 / 0 / 0                                                        | simulating a deck: opening hands, goldfish, odds, castability, cast effects                                                                 |
| `proxies`  | 5 / 4 / 3 / 1 / 2                                                        | printing a deck: proxy sheets, playtest cards, token proxies, PDF renderer                                                                  |
| `overview` | 0 / 2 / 0 / 6 / 0                                                        | the reads that combine the others: deck overview and facts, `reads`, snapshot comparison, the optimizer read                                |

Before: `domain` 46, `application` 30, `queries` 28, `infrastructure` 8, `testing` 3 source files
in one folder each. The mana and plan files (`mana-symbols`, `mana-payment`, `deck-profile`) are in
`core`: stats and the deck view read them.

`overview` is a sixth responsibility, not in the plan's five. Without it the combining files
(`deck-overview`, `deck-facts`, `reads`, `scorecard`, snapshot comparison) would give `core` an
arrow to every other area, and the cycle check would fail.

**Arrows** (an area may import only those to its right):

```
overview → building → scoring → core
overview → building → play    → core
overview → proxies  → core
```

`core` imports no other area. `scoring`, `play` and `proxies` import only `core`; `building`
imports `scoring`, `play` and `core`; `overview` imports all. Nothing imports `overview` or
`building` except `overview`, the module's `wiring.ts` and its `index.ts`.

**Public APIs.** An area has `index.ts` (everything other areas and the module root use) and, where
pure code crosses the boundary, `client.ts` (domain code only; ADR 0016). A file in another area
may import only `<area>/client.ts` or `<area>/index.ts` (`<area>/testing/*` for fakes and
`<area>/infrastructure/schema.ts` for the table definitions too, as other modules already do). A
domain file imports only `client.ts`, so no server code reaches the browser. A lint
rule (`eslint.config.mjs`) enforces it with the arrows above. The module's own `index.ts` and
`client.ts` re-export the areas' (`export *`), so other modules still import only `@/modules/decks`
(and so everything an area offers its sibling areas is visible to the app: keep area APIs short).
The cycle check treats each area as a node.

**Names.** `draft-deck` is now `build-from-collection` (the `drafts` module is something else).
The area names live in the folder names, the lint table and the cycle-check table only.

**The orchestration.** `deckSuggestions`, `similarCards`, `budgetList` and `budgetReplacements`
are `building/application/suggest-cards.ts`. They take a `CandidatePool` port (the SQL that finds
candidate cards), implemented in `building/queries/suggestion-pool.ts`. The port is declared in
`building/domain/suggestion-types.ts`, because the query layer may not import `application`. A fake
pool tests them without a database. The optimizer read (`optimizeDeckForView`) joins the deck view
and the suggestions, so it is in `overview`.

## Consequences

- A file's folder says what it is for; the lint rule keeps the areas apart.
- Every layer folder of every area has at most 12 source files, except `core`'s `domain` and
  `application` (20 each; see Follow-ups).
- The module root is `index.ts` and `client.ts` (8 and 6 lines), `wiring.ts`, and
  `infrastructure/index.ts` for the composition roots.
- Production code grew by 132 lines (75,505 to 75,637): the area APIs cost about what the old
  225-line `index.ts` and 143-line `client.ts` did, and each cross-area import is a multi-name
  statement where a relative single-name one was before.

## Follow-ups

- `core/domain` and `core/application` still have 20 source files each. That is a seventh
  responsibility: **sharing** and **changes** (previews, snapshots) could be areas, but `core`'s
  `ports.ts`, `make-decks.ts`, `drizzle-repositories.ts` and the fakes reference both today. Moving
  them needs the owner's names and a package of its own.
