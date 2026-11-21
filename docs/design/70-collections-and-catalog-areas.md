# Design: one collection module, and catalog split into areas

- **Phase:** Refactor package P30
- **Status:** In review (the owner confirms the names; ADR 0030)
- **Related ADRs:** 0017, 0023, 0029, 0030
- **Related design docs:** 16 (real collection; rule 1 stays), 65 (refactor)
- **Lesson:** deferred (the refactor defers lessons)

A small design for a move. No new behaviour, no table change, no migration.

## 1. Purpose & scope

Three changes: merge `real-collection` into `collection`; split `catalog` into `cards`, `rules`
and `outside`; group `reddit` and `youtube` as `research`. A fourth is a consequence: the SQL in
`shared/card-search` moves to the modules whose tables it names. **Out of scope:** the decks
areas (P18), the core split and narrower exports (P20), UI components (P31).

## 2. Layout

```
src/modules/catalog/      cards/  rules/  outside/   index.ts  make-catalog.ts  wiring.ts  infrastructure/index.ts
src/modules/collection/   game/   real/   copies/    index.ts  wiring.ts  infrastructure/index.ts
src/modules/research/     reddit/ youtube/           index.ts  wiring.ts  infrastructure/index.ts
```

Each area has `domain/`, `application/`, `infrastructure/`, `queries/`, `testing/` as it needs, and
an `index.ts`. Arrows and what each area holds: ADR 0030.

## 3. Where files went

| Old                                                                                                                                        | New                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `catalog/**` for rules (`comprehensive-rules`, `related-rules`, `rules-search`, `rules`, `rules-lookup`, `drizzle-rules`, `rules-gateway`) | `catalog/rules/**`                                   |
| `catalog/**` for EDHREC, Spellbook, embeddings, `outside-data`                                                                             | `catalog/outside/**`                                 |
| the rest of `catalog/**` (sync, prices, images, WPN artwork, features, queries)                                                            | `catalog/cards/**`                                   |
| `catalog/application/make-catalog.ts`                                                                                                      | `catalog/make-catalog.ts`                            |
| `catalog/application/ports.ts`, `catalog/infrastructure/schema.ts`                                                                         | one per area                                         |
| `collection/**`                                                                                                                            | `collection/game/**`                                 |
| `real-collection/**`, `real-collection/wiring.ts`                                                                                          | `collection/real/**`, `collection/wiring.ts`         |
| `shared/card-search/sql.ts`                                                                                                                | `catalog/cards/queries/search-sql.ts`                |
| `shared/card-search/sql-collection.ts`                                                                                                     | `collection/copies/queries/copies-sql.ts`            |
| `reddit/**`, `youtube/**`, their `wiring.ts`                                                                                               | `research/{reddit,youtube}/**`, `research/wiring.ts` |

`shared/card-search` keeps `parse`, `list`, `help` and their tests. `tags`, `brackets`,
`signals` and `primitives` were already gone (P13).

## 4. Invariants

1. Real cards never touch the game's money (design doc 16, rule 1): `collection/real` imports only
   `copies`, `accounts` and `catalog`; nothing but the app, the composition roots and the tests
   imports `@/modules/collection/real`. Lint, plus `tests/integration/collection-real.int.test.ts`.
2. No table is renamed, no migration is written.
3. An area is imported only through its `index.ts`, along the arrows.

## 5. Open questions (the owner)

- The names `cards`, `rules`, `outside`, `game`, `real`, `research`; and `copies`, the third
  collection area, which the plan did not name.
- WPN artwork stays in `cards` (the plan listed `wpn*` under `outside`); see ADR 0030.
