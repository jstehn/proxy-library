# Remove later

Temporary scaffolding and dead-code candidates found during the refactor. Each row names who
removes it and when. **Add a row the moment you leave something behind** (in the same commit), and
delete the row in the commit that removes the thing. A package is not done while a row names it and
is still open. Mirrored in tududi (task "Removal register").

> **Re-assigned by the plan revision (2026-11-19).** Each row below moved to the package that now
> owns it. Rows that P24 or P25 make obsolete were deleted, and are noted at the end. New rows
> come from P23–P34 themselves: a package that adds a temporary list (an allowlist, a
> `NOT_YET_…` list, a report-only check) names who deletes it.

## Scaffolding (built to get from A to B; delete when B is reached)

| What                                                                                                                                                                                                                                                                      | Where                                                | Why it exists                                                                              | Remove in                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `CONTAINER_ALLOWED`: re-check each reason                                                                                                                                                                                                                                 | `eslint.config.mjs`                                  | `_oauth/http.ts`, `api/health/route.ts`                                                    | P21 (final review)                                                                                                      |
| One-line forward bundles: `deckReads`, `collectionReads`, `realCollectionReads`, `draftReads`, `inventoryReads`, `storeReads`, `catalogReads`, `packReads`, `wishlistReads` (and the others: `activityReads`, `accountReads`, `walletReads`, `socialReads`, `tradeReads`) | each module's `wiring.ts`                            | UI callers needed a path that isn't `db`; they forward to the old query functions          | **P25**, one module per commit, each bundle deleted with its module's callers (replaces "P11, P15–P18, then P20 sweep") |
| Service pass-through in `capabilities` (`deckEdits` = all of `Decks`, `deckSharing`, `drafts`, `realCollection`, `store`, `inventory`, `chooseToken`, `proxySheet`, `seeds`, `now`) and the 17-service list                                                               | `src/server/capabilities.ts`, `core.ts` (`services`) | the UI calls whole services; narrower capabilities come when a package rewrites the caller | **P25** (replaces "P18, P19, P20")                                                                                      |
| `readPage()` inside FormData actions                                                                                                                                                                                                                                      | `app/**/actions.ts` (decks, drafts, collection, …)   | `action(schema)` takes parsed input, FormData actions don't fit                            | **P25** (`formAction`; replaces "P20")                                                                                  |
| `rulesLookup`, `lookUpCards`, `searchCatalog` joined in `capabilities.ts`                                                                                                                                                                                                 | `src/server/capabilities.ts`                         | they read across modules; no one module's wiring may hold them                             | **P30** (the catalog split and the collection merge decide where they live; replaces "P18")                             |
| `printingDetails` beside `lookUpCards`'s `detail`                                                                                                                                                                                                                         | `catalog/wiring.ts`, `capabilities.ts`               | two readers of printing details                                                            | **P30** (replaces "P20")                                                                                                |
| `CONTAINER_ALLOWED` `_oauth/http.ts`: make `issuer()` and `resourceMetadataUrl()` async (or take the origin as an argument), then drop the entry; `api/health/route.ts`: give the container's `checkHealth` a capability and drop it                                      | `eslint.config.mjs`                                  | P09d                                                                                       | P21                                                                                                                     |
| `headerSummary` composes five modules in `capabilities.ts`                                                                                                                                                                                                                | `src/server/capabilities.ts`                         | one round trip for the site header                                                         | **P25** (design doc 67 decides: a `site` capability or stays, reading through `reads`)                                  |
| `readCapabilities()` for routes that don't resolve a player (images, artwork, OpenAPI, the tool endpoints)                                                                                                                                                                | `src/server/page-instance.ts`                        | routes without a signed-in player                                                          | keep (P25's design doc names it)                                                                                        |

## Added by the plan revision (temporary on purpose)

| What                                                                                                   | Where                          | Added by | Remove in                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------ | -------- | ------------------------------------------------------------ |
| `knip (report)`: a non-failing step in `scripts/check.sh` (it becomes a gate)                          | `scripts/check.sh`             | P23      | P24                                                          |
| The `knip` allowlist entries, each with a reason                                                       | `knip.json`                    | P24      | P30 (the structure is final), or when the reason is gone     |
| `NOT_YET_RECOGNIZED`: files allowed to keep oracle-text regexes                                        | `eslint.config.mjs`            | P11      | P12, P13 and P14, each slice removes its files; empty at P14 |
| `regex-baseline.txt` (a ratchet, stays)                                                                | `docs/refactor/`               | P11      | archived with `docs/refactor/`                               |
| `module-cycles-baseline.txt` (must reach empty)                                                        | `docs/refactor/`               | P29      | P29                                                          |
| `NOT_YET_ON_BLOCKS`: files allowed to keep long class strings                                          | `eslint.config.mjs`            | P31      | P31 (empty at the end)                                       |
| `FormatRuleSet.commandZoneTaxPerCast`: read by the deleted goldfish cast modifier; check it has a user | `decks/domain/format-rules.ts` | P24      | P28 (keep if the effect registry reads it, else delete)      |
| The last commit that had `sim-pipeline.ts`, named in P24's handoff, for P28 to read                    | P24 handoff                    | P24      | P28                                                          |

## Duplicates to fold

| What                                                                             | Where                             | Remove in                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `startDeckAction` repeats `startDeck`'s create-and-import (adds `usesRealCards`) | `app/decks/commanders/actions.ts` | **P32** (it splits the commanders page and actions; replaces "P11 or P19") |

## Removed from this list by the plan revision

- **Dead-code candidates** (`planPackageInsert`, `dealMulliganDrill`, `evaluateMulliganDecision`,
  `chanceByTurn`, `exportWithTags`, `primerSections`, `preparedForTest`, `msrpFor`,
  `viewerRelation`, `defaultProfile`): the owner answered "delete all of it", so **P24** deletes
  them with the feature code. The section is gone. (P24's Deletes table lists each one and the two
  that must be checked first.) `actFor`, `TtlCache` and the `fixture…Gateway` functions from
  report 2 are **not** dead: they have production callers.
- **"The user decides first (no feature cuts)"** for those candidates: answered by the owner.
- **Tools already removed on purpose:** the 27 unregistered LLM tools (decision 5 in STATUS). The
  card-package tools have no equivalent in the builder either: the card-packages feature is now
  deleted by **P24**, so P20's "check whether the feature is dead" row is closed.
