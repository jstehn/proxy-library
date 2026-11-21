# 0030. One `collection` module, `catalog` and `research` split into areas

- **Status:** Proposed (the owner confirms the area names; refactor P30, plan review decision 4 and the owner's answer on collections)
- **Date:** 2026-11-20
- **Extends:** 0001, 0017, 0029

## Context

- `collection` (the game's cards) and `real-collection` (cards a player owns physically) were two
  modules for one idea. The owner said to merge them unless there was a purpose to keep them apart.
  The purpose that mattered is design doc 16, rule 1: real cards never touch the game's money.
- `catalog` was 11k lines doing three jobs: card data, the Comprehensive Rules, and data from other
  sites (EDHREC, Commander Spellbook, embeddings).
- `reddit` and `youtube` were two small modules that both serve the research tools.
- `shared/card-search` held, besides the search language, 830 lines of SQL for catalog and
  collection tables.

## Decision

Same shape as ADR 0029: an **area** is a folder with the usual layer folders and its own
`index.ts`; a file imports another area only through that `index.ts`, along fixed arrows (lint, in
`AREA_ARROWS` of `eslint.config.mjs`; the cycle check treats each area as a node).

| Module       | Area      | Holds                                                                               | Arrows to |
| ------------ | --------- | ----------------------------------------------------------------------------------- | --------- |
| `catalog`    | `outside` | EDHREC, Commander Spellbook, Scryfall rulings, card text embeddings                 | none      |
|              | `rules`   | the Comprehensive Rules: parsing, sync, lookup, related rules                       | `outside` |
|              | `cards`   | sets, printings, prices, images, artwork (WPN), the sync, card features, search SQL | `outside` |
| `collection` | `copies`  | the SQL both collections share: list, filter, sort, export a player's copies        | none      |
|              | `game`    | copies bought and opened in the game, with their acquisitions                       | `copies`  |
|              | `real`    | real cards: import, sharing, real sealed products. No price, no ledger, no store    | `copies`  |
| `research`   | `reddit`  | threads and post search                                                             | none      |
|              | `youtube` | transcripts and deck-tech video search                                              | none      |

**`cards` imports `outside`, not the reverse.** The nightly sync starts the EDHREC and Spellbook
syncs. `rules` imports `outside` for the text embedder and the Scryfall ruling types. The WPN
files (`wpn`, a set page's artwork) stay in `cards`: they use the printing types and feed the
artwork pass, so putting them in `outside` would need an arrow back.

**Ports and tables are per area.** `catalog/application/ports.ts` became one `ports.ts` per area
(`CardsServices`, `OutsideServices`, `RulesServices`, and the matching `…Dependencies`);
`catalog/make-catalog.ts` joins them into `CatalogServices` and `CatalogDependencies`. The tables
are split the same way (`cards`, `outside`, `rules` each have an `infrastructure/schema.ts`). **No
table was renamed and there is no migration.** `pgVector` moved to `shared/db` (two areas use it).

**Real cards never touch the game's money** (design doc 16, rule 1) is kept by four things:

1. `collection/index.ts` exports the game area only. The real collection's door is
   `@/modules/collection/real`, which only the app, the composition roots and the tests may import
   (lint). So no other module can use it, as before.
2. `real` may import `copies` and no other area (the arrows), so never `game`.
3. `real` may import no module but `accounts` and `catalog` (a lint policy), so never `wallet`,
   `store`, `inventory` or `trades`.
4. `tests/integration/collection-real.int.test.ts` (was `real-collection.int.test.ts`) checks the
   isolation: a reset leaves real cards alone, and a real card can't be sold to the store.

**`shared/card-search` keeps the search language** (`parse`, `list`, `help`). Its SQL moved:
`sql.ts` to `catalog/cards/queries/search-sql.ts` (every module's `queries/` may import that one
file, replacing the old `@/shared/card-search/sql` exception) and `sql-collection.ts` to
`collection/copies/queries/copies-sql.ts`. The pieces of `card-search` that P13 had already moved
(`tags`, `brackets`, `signals`, `primitives`) are gone from it. ADR 0017's text is amended.

**Research.** `research/{reddit,youtube}`: each area keeps its layers and its `index.ts`; the root
has `index.ts`, `wiring.ts` (both capabilities) and `infrastructure/index.ts`.

**Names.** The module and area names live in folder names, in `AREA_ARROWS`
(`eslint.config.mjs`) and in `AREAS` (`scripts/check-cycles.ts`); a rename touches those and the
imports.

## Consequences

- A catalog file's folder says what it is for; each folder has at most 11 source files.
- One `collection` module, one `wiring.ts`, no second module shell.
- Anyone who needs real cards imports `@/modules/collection/real` by name, which keeps the rule
  visible in the import list.
- `copies` is a third area the plan did not name. The listing SQL is shared by both collections,
  and without it one of them would import the other.

## Follow-ups

- Lessons that mention the old paths were not touched (deferred, as in P18).
