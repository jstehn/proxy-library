# Remove later

Temporary scaffolding and dead-code candidates found during the refactor. Each row names who
removes it and when. **Add a row the moment you leave something behind** (in the same commit), and
delete the row in the commit that removes the thing. A package is not done while a row names it and
is still open. Mirrored in tududi (task "Removal register").

## Scaffolding (built to get from A to B; delete when B is reached)

| What                                                                                                                                                                                | Where                                                | Why it exists                                                                              | Remove in                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `CONTAINER_ALLOWED`: re-check each reason                                                                                                                                           | `eslint.config.mjs`                                  | `_oauth/http.ts`, `api/health/route.ts`                                                    | P21 (final review)                                      |
| One-line forward bundles: `deckReads`, `collectionReads`, `realCollectionReads`, `draftReads`, `inventoryReads`, `storeReads`, `catalogReads`, `packReads`, `wishlistReads`         | each module's `wiring.ts`                            | UI callers needed a path that isn't `db`; they forward to the old query functions          | each as its queries merge: P11, P15–P18, then P20 sweep |
| Service pass-through in `capabilities` (`deckEdits` = all of `Decks`, `deckSharing`, `drafts`, `realCollection`, `store`, `inventory`, `chooseToken`, `proxySheet`, `seeds`, `now`) | `src/server/capabilities.ts`, `core.ts` (`services`) | the UI calls whole services; narrower capabilities come when a package rewrites the caller | P18, P19, P20                                           |
| `readPage()` inside FormData actions                                                                                                                                                | `app/**/actions.ts` (decks, drafts, collection, …)   | `action(schema)` takes parsed input, FormData actions don't fit                            | P20 (a `formAction` helper, or schemas)                 |
| `rulesLookup`, `lookUpCards`, `searchCatalog` joined in `capabilities.ts`                                                                                                           | `src/server/capabilities.ts`                         | they read across modules; no one module's wiring may hold them                             | P18 (decks split) decides                               |
| `printingDetails` beside `lookUpCards`'s `detail`                                                                                                                                   | `catalog/wiring.ts`, `capabilities.ts`               | two readers of printing details                                                            | P20                                                     |

Added in P09d:

| What                                                                                                                                                                                                                                 | Where                                   | Remove in                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------ |
| `CONTAINER_ALLOWED` `_oauth/http.ts`: make `issuer()` and `resourceMetadataUrl()` async (or take the origin as an argument), then drop the entry; `api/health/route.ts`: give the container's `checkHealth` a capability and drop it | `eslint.config.mjs`                     | P21                                              |
| The pass-through list in `capabilities.services` grew to 17 services (accounts, wallet, social, trades, wishlist, catalog, packs, resetPlayer, `appUrl` and the P09c ones)                                                           | `src/server/capabilities.ts`, `core.ts` | P18 to P20, as callers get narrower capabilities |
| `headerSummary` composes five modules in `capabilities.ts`                                                                                                                                                                           | `src/server/capabilities.ts`            | keep, or move to a `site` module in P20          |
| `readCapabilities()` for routes that don't resolve a player (images, artwork, OpenAPI, the tool endpoints)                                                                                                                           | `src/server/page-instance.ts`           | keep                                             |

## Duplicates to fold

| What                                                                             | Where                             | Remove in  |
| -------------------------------------------------------------------------------- | --------------------------------- | ---------- |
| `startDeckAction` repeats `startDeck`'s create-and-import (adds `usesRealCards`) | `app/decks/commanders/actions.ts` | P11 or P19 |

## Dead-code candidates (used only by tests; confirm with the user whether the feature is dead)

`decks/domain`: `planPackageInsert` (card packages: also see P20's check), `dealMulliganDrill`,
`evaluateMulliganDecision`, `chanceByTurn`, `exportWithTags`, `primerSections`, `preparedForTest`.
`store/domain`: `msrpFor`. `social/domain`: `viewerRelation`, `defaultProfile`.
**Owner: P20.** The user decides first (no feature cuts; decision 4 of the audit).

## Tools already removed on purpose

The 27 unregistered LLM tools, per decision 4 (STATUS). The card-package tools have no equivalent in
the builder either; P20 checks whether the feature is dead.
