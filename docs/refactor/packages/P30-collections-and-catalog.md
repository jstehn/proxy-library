# P30. Merge the collections, and split `catalog` by responsibility

- **Branch:** `refactor/P30-collections-catalog` · **Depends on:** P18, P29 · **Parallel with:** none (moves files across modules)
- **Source:** [plan review](../reviews/plan-review/README.md) (P30; owner answer on collections, decision 4), reports [1](../reviews/plan-review/1-architecture.md) and [5](../reviews/plan-review/5-docs-tests-dx.md)
- **Lines:** none stated. The expected net is ≤ 0. Two modules collapsing into one removes a `wiring.ts`, an `index.ts`, two `ports.ts` copies and about 100 lines of re-declared shapes. Record the real number.
- **Big feature:** needs a design doc and ADR 0029 before code (ADR 0023).

## Why

- `collection` (the game's cards) and `real-collection` (real cards the player owns) are two
  modules for one idea. The owner said to **merge them**, unless there is a purpose to keep them
  apart. Design doc 16's purpose, **real cards never touch the game's money**, stays: it is kept
  inside the merged module as a rule and a test.
- `catalog` is three jobs in one module (11k lines): card data (sync, prices, images), the
  comprehensive rules (lookup), and outside deck data (EDHREC, Commander Spellbook, embeddings,
  WPN). Per decision 4 it becomes one module with subfolders, each with its own `index.ts`,
  importing each other only through them (the P18 rule).
- `shared/card-search` is module code in disguise (5.1k lines). Only the search language is truly
  shared.

## Deletes

| What                                                                                                                                                                                                      | Where                                                                            | Lines                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The second module shell: `real-collection/{index,wiring}.ts`, its `ports.ts`, its `schema.ts` wrapper if the tables merge cleanly (keep the table names: no migration)                                    | `src/modules/real-collection/`                                                   | −80 to −200                                                                         |
| Duplicate queries and query-shape types between the two (`collectionPage` / `realCollectionPage`, `ownedByOracle` / `realOwnedByOracle`) after P17's shared SQL                                           | `collection/queries/collection.ts`, `real-collection/queries/real-collection.ts` | −60 to −150                                                                         |
| The `collectionReads` and `realCollectionReads` leftovers (if P25 left any), and the two `wire…Capabilities`                                                                                              | `wiring.ts` of both                                                              | −30 to −80                                                                          |
| `shared/card-search` pieces that don't belong: `brackets.ts` (and test), `signals.ts`, `tags.ts` (these are mostly deleted by P13 by then: verify what is left), `primitives.ts`, and the `sql*.ts` files | `src/shared/card-search/`                                                        | moved, not deleted: net 0, but each import path through `@/shared/card-search` goes |
| `catalog/client.ts` (if P24 didn't) and every re-export in `catalog/index.ts` that the split makes unneeded                                                                                               | `src/modules/catalog/index.ts`                                                   | −30 to −80                                                                          |
| The `lookUpCards` / `searchCatalog` / `rulesLookup` joins in `capabilities.ts` if P25 left them there                                                                                                     | `src/server/capabilities.ts`                                                     | −20 to −40                                                                          |

Verify each before starting: `ls src/shared/card-search`, `wc -l` on the files, and
`grep -rn "@/shared/card-search" src | grep -v test | wc -l`.

## Touches

`src/modules/{collection,real-collection,catalog,research,reddit,youtube}`, `src/shared/card-search`,
`src/server/{capabilities,core}.ts`, imports across `src/app` and `worker`, `eslint.config.mjs`
(boundaries and the sub-folder rule), `docs/architecture/overview.md`, new
`docs/design/NN-collections.md` and `docs/adr/0029-merge-collections-split-catalog.md`.
**Avoid** UI components (P31).

## Steps

1. **ADR 0029 and a short design doc.** Say, for each of the three changes: the new folder names,
   what each exports, the allowed arrows, and where design doc 16's money rule lives. Get the
   owner's OK on the names (see "Needs the owner").
2. **Merge the collections** into `src/modules/collection/`, with `game/` and `real/` parts (both
   keep their `domain`, `application`, `infrastructure`, `queries` layers inside, or one set of
   layers with `game-*` and `real-*` files; the ADR picks). One commit per layer.
   - Keep the table names and the schema unchanged. No migration.
   - Keep the rule: no code path in `real/` may import the wallet, store or ledger. Add a lint
     rule for it (`real/**` may not import `@/modules/wallet`, `@/modules/store`), and keep the
     integration test `tests/integration/real-collection.int.test.ts` (rename it).
   - Delete the old module's files in the same commit that moves each.
3. **Split `catalog`** into subfolders `cards/` (sync, prices, images, artwork, search), `rules/`
   (`comprehensive-rules`, `rules`, `rules-lookup`, `related-rules`, `rules-search`,
   `drizzle-rules`, `rules-gateway`) and `outside/` (`edhrec*`, `spellbook*`, `embed*`,
   `embedder`, `wpn*`, `outside-data`). Each gets its own `index.ts`, and **imports go only through
   subfolder `index.ts` files** (lint, as in P18). Aim for every folder ≤ 12 files. `git mv`, one
   subfolder per commit.
4. **`card-search` keeps only the search language** (`parse`, `list`, `help`, and the shared
   pieces they need). Move the rest to its owner, one commit each:
   - `brackets.ts` → `decks` (core or advice, per P18's layout)
   - `signals.ts`, `tags.ts`, `primitives.ts` → the owners that remain after P13 (probably
     `catalog/cards` for stored tags, `decks` for deck signals). Anything P13 already deleted is
     simply gone: list it.
   - `sql*.ts` → `catalog/cards/queries` (card SQL) and `collection/queries` (collection SQL).
     `@/shared/card-search/sql` goes away, and ADR 0017's text is amended.
5. **Group `reddit` and `youtube`** under `src/modules/research/` (`reddit/`, `youtube/`, each with
   its own layers), as the audit planned (the model is in doc 65's change log, 2026-11-18). Their
   `wiring.ts` from P25 moves with them.
6. Update lint boundaries, `docs/architecture/overview.md` (module table and graph), `CLAUDE.md`'s
   mention of `@/shared/card-search/sql` (P21 trims that file later; change only what is now false).
7. Run `pnpm check`, `pnpm test:int`, and the e2e spec for the collection and real cards
   (`pnpm test:e2e tests/e2e/accounts.spec.ts -g "real cards"`). `pnpm sizes --update`.

## What not to do

- Don't change a table name or write a migration.
- Don't merge the two collections' domain rules. Real cards have no price, no ledger, no store.
- Don't leave a re-export from the old path "for now".
- Don't split `decks` here (P18 did).

## Done when

- `ls src/modules` shows no `real-collection`, `reddit` or `youtube` (they are in `collection` and
  `research`).
- `ls src/shared/card-search` shows only the search language files.
- `ls src/modules/catalog` shows `cards`, `rules`, `outside`, `index.ts`, and no folder has more
  than 12 source files.
- The lint rules for "real cards never touch money" and for subfolder imports are on.
- `pnpm check`, `pnpm test:int` and the collection e2e spec are green. The handoff lists the files
  deleted and the line change.

## Needs the owner

- The names of the new subfolders (`cards`, `rules`, `outside`; `game`, `real`) and ADR 0029.

## Handoff

(empty)
