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

| Area       | What it holds                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`     | the deck itself: lists, legality, formats, brackets, headings, boards, stats, snapshots, change previews, sharing, the repositories (ports) |
| `scoring`  | rating and ranking cards for a deck: `rate`, `signals`, `suggest`, `cuts`, `swaps`, `replacements`, `optimize`                              |
| `building` | making a deck: `build-from-collection`, `mana-base`, commanders, candidate pool, suggestion orchestration, audit report                     |
| `play`     | simulating a deck: opening hands, goldfish, odds, castability, mana payment effects                                                         |
| `proxies`  | printing a deck: proxy sheets, playtest cards, token proxies, PDF renderer                                                                  |
| `overview` | the one read model that combines the others: the deck overview, deck facts, the reads that call several areas, snapshot comparison          |

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
`building` except the module's own `wiring.ts` and `index.ts`.

**Public APIs.** An area has `index.ts` (everything other areas and the module root use) and, where
pure code crosses the boundary, `client.ts` (domain code only; ADR 0016). A file in another area
may import only `<area>/client.ts` or `<area>/index.ts` (`<area>/testing/*` too, for fakes). A lint
rule (`eslint.config.mjs`) enforces it with the arrows above. The module's own `index.ts` and
`client.ts` re-export the areas' (`export *`), so other modules still import only `@/modules/decks`.
The cycle check treats each area as a node.

**Names.** `draft-deck` is now `build-from-collection` (the `drafts` module is something else).
The area names live in the folder names, the lint table and the cycle-check table only.

**The orchestration.** `deckSuggestions`, `similarCards`, `budgetList` and `budgetReplacements`
are `building/application/suggest-cards.ts`. They take a `CandidatePool` port (the SQL that finds
candidate cards), implemented in `building/queries/suggestion-pool.ts`. A fake pool tests them
without a database.

## Consequences

- A file's folder says what it is for; the lint rule keeps the areas apart.
- Every area's layer folders have at most 12 source files, except `core`'s `domain` and
  `application` (see Follow-ups).
- The module root is three small files: `index.ts`, `client.ts`, `wiring.ts` (and
  `infrastructure/index.ts` for the composition roots).

## Follow-ups

- `core/domain` and `core/application` still have about 20 source files each. That is a seventh
  responsibility: **sharing** and **changes** (previews, snapshots) could be areas, but `core`'s
  `ports.ts` and `make-decks.ts` reference both today. Splitting them is a later package.
