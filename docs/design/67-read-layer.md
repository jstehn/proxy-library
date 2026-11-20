# Design: The read layer, secure by construction

- **Phase:** Refactor package P25 (design doc 65, owner answer 3)
- **Status:** Proposed (awaiting the owner's approval)
- **Related ADRs:** 0006 (reads are query functions), 0009 (module boundaries), 0026 (capabilities; addendum "Reads"), 0023 (process)
- **Lesson:** no (the refactor defers lessons)

Written from `refactor/main` at "Test layout decided". No code changes with this doc. Counts and
line numbers are from that commit.

## 1. Purpose & scope

Pages and actions read through 14 `*Reads` bundles of one-line `withDb` forwards (97 reads) and
through 17 services passed whole. The owner chose an honest query layer (answer 3): reads are each
module's typed query functions, called directly. Capabilities are for writes and for anything with
rules. The owner also wants it **secure by construction**: a per-player read can't be called
without the signed-in player.

This doc fixes the shape. It also lists every read, who may call it, and what a test pins.

**Out of scope:** moving modules or files (P18, P30), page states and `paths.ts` (P32), and fixing
the security findings in section 10 (reported only).

## 2. The three kinds of read

| Kind                  | First parameter        | Who may call it             | Access rule, in SQL                                                      |
| --------------------- | ---------------------- | --------------------------- | ------------------------------------------------------------------------ |
| **P** player          | `actor: Actor`         | the signed-in player        | every row is filtered by `actor.userId` (`where owner_id = $actor`)      |
| **S** shared          | `actor: Actor` or none | any signed-in player        | the row is visible to this viewer: shared, public, or catalog data       |
| **A** admin           | `admin: AdminActor`    | only an admin               | the type is the rule; an `AdminActor` exists only after the admin guard  |
| **V** visitor (token) | the token (or nothing) | anyone, including a visitor | the token is the credential (`public_token = $token`), or no data at all |

Rules for all of them:

1. A P read never takes a `UserId` or `string` id from the caller. It takes the `Actor`.
2. An S read that depends on who is looking (a shared deck, a profile, a wishlist) takes the
   `Actor` too and puts the visibility test **in the SQL**. Today three of them test it in
   TypeScript after fetching the row (section 10, F6). A read that shows the same thing to every
   signed-in player (the catalog, store prices) takes no actor.
3. Another player's data is reached only through an S read built for it (`sharedFor(actor, ownerId)`),
   never by passing someone else's id to a P read.
4. "Not allowed" looks the same as "not there": `null` or an empty list, never a different error.
5. An A read takes `AdminActor`. Admin capabilities (writes) keep their own `isAdmin` check as well.

## 3. How a page gets them

```ts
// src/server/page-instance.ts
const { actor, capabilities, reads } = await readPage();
const decks = await reads.decks.decksFor(actor); // P: the actor goes in, visible at the call site
```

- `readPage()` returns `{ actor, capabilities, reads }`. `action()` and `formAction()` hand the same
  three to their handler.
- `readPage({ admin: true })` returns `actor: AdminActor`, so admin reads type-check only there.
- `readPage({ allowVisitors: true })` returns a union, narrowed by `actor`:
  `{ actor: Actor; reads: Reads } | { actor: null; reads: PublicReads }`. `PublicReads` holds only
  the V reads, so a visitor's page can't call anything else (it won't compile).
- `reads` is built once, in `src/server/reads.ts`, from the same `db` the capabilities use:

```ts
export function buildReads(db: DbExecutor) {
  return {
    accounts: bindDb(db, accountQueries),
    decks: bindDb(db, deckQueries),
    // ...one line per module, 14 in all (not 14 bundles of forwards)
  };
}
export type Reads = ReturnType<typeof buildReads>;
```

Each module exports its public reads as one namespace from `queries/index.ts` (and re-exports it
from the module's `index.ts` for `src/server` only). A query that is a helper and not a public
read stays unexported. The module's `*Reads` bundle and `withDb` calls in `wiring.ts` are deleted
in the same commit that moves the module.

## 4. `bindDb` or plain functions

**Options.**

- **A. `bindDb(db, queries)`:** one generic helper that drops the first parameter of every function
  in a namespace. `reads.decks.deckView(actor, deckId)`.
- **B. Plain functions:** `reads.ts` lists each read by hand (`deckView: (a, d) => deckView(db, a, d)`).
  About 97 lines of the same forward we are deleting.
- **C. Factories:** every query file becomes `makeDeckQueries(db)`. About 150 functions rewritten.
- **D. Ambient `db`** (async local storage). No parameter at all, but hidden state.

**Recommendation: A.** Why:

- It keeps the queries as they are, `(db, actor, ...)`, so they stay easy to test with a real
  database and to read as SQL.
- B is the repetition the owner asked to remove, and every new query would need a forward.
- Clicking through works. `bindDb`'s result type is a homomorphic mapped type, so "Go to definition"
  on `reads.decks.deckView` lands on the real function, and hover shows `(actor: Actor, deckId:
number)` because the tuple's names are kept. `src/shared/db/with-db.ts` already holds the same
  type trick (`WithoutDb`); `bindDb` replaces it and is about 12 lines.
- **Risk:** I have not run the click-through. The first module moved (`activity`, the smallest)
  checks it. If it fails, we fall back to B for the cost of about 97 lines, and nothing else changes.

The `Actor` stays an explicit argument rather than being bound into `reads` at `readPage()`. That
way a reviewer sees who a read is for at the call site, and an S read called with another player's
id looks wrong (open question 2).

## 5. Routes with no player

| Route                                             | Signs in with      | Gets                                                                    |
| ------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `/api/images/...`, `/api/artwork/...`             | none (cookie only) | `readCapabilities()`: `catalog.imageFor`, `artworkFor`                  |
| `/api/tools/openapi.json`                         | none               | `readCapabilities()`: `appUrl`, no data                                 |
| `/api/mcp`, `/api/tools/[name]` (`http.ts`)       | bearer token       | `readTool(request)`: `{ actor, scopes, capabilities, reads }`           |
| `/d/[token]`, `/d/[token]/scorecard`              | the link token     | `readPage({ allowVisitors: true })` and `reads.decks.publicDeck(token)` |
| `/api/health`, OAuth endpoints (`_oauth/http.ts`) | none / OAuth form  | `getContainer()` (on `CONTAINER_ALLOWED`, each with its reason)         |

- `readCapabilities()` stays, but only for routes that read nothing from the database for a player
  (images, artwork, OpenAPI).
- New `readTool(request)` in `src/server/` does today's `toolContextFor` (`_llm-tools/http.ts:13`):
  token to `Actor`, then `{ actor, scopes, capabilities, reads }`. Tool bindings use no `*Reads`
  today, so `reads` there is for later and costs nothing.
- Shared-deck tokens are V reads. They take the token and join `decks.public_token` in SQL.
  `tokenLines(deckId, ...)` becomes `publicDeckTokens(token, makers)` so a visitor can't pass a
  deck id.

## 6. Actors that can't be forged

Today `Actor` is a plain object type, so any file can write `{ userId, isAdmin: true, ... }`
(16 test files do).

1. **Brand the types.** `Actor` and `AdminActor` carry a `unique symbol` brand that is declared but
   not exported. A literal doesn't type-check. `AdminActor = Actor & { [adminBrand]: true }`.
2. **One door.** The only producers are in the accounts module: `getActor` and `actorFromToken`
   (cookie and token), and `accounts.asAdmin(actor): AdminActor | null`. Only `src/server/session.ts`
   calls `asAdmin`, in `requireAdminActor()`. Adapters can't call it: they have no
   `getContainer()` (lint, ADR 0026).
3. **Lint** (`no-restricted-syntax`): no `as Actor` or `as AdminActor` outside `*.test.ts` and
   `**/testing/`.
4. **Test helpers.** `@/modules/accounts/testing` exports `testActor(overrides)` and
   `testAdminActor()`. The 16 test files and `tests/integration/harness.ts` use them.
5. **Never from the client.** `action()` and `formAction()` take no actor or user id from input.
   A form field `userId` (the admin player forms) is a _target_, and the handler runs it through
   an `AdminActor` capability.
6. **A type check, not a scan.** Each module's `queries/index.ts` has a line like
   `const _noPlainUserId: NoPlainUserId<typeof deckQueries> = deckQueries;`. `NoPlainUserId` maps
   any function whose first parameter after `db` is `UserId` to `never`, so `pnpm typecheck`
   fails. The exceptions are the internal queries (section 7B), which are not in the namespace.

If the accounts import of `Actor` makes a cycle with `decks` (the cycle check from P22), the two
types move to `@/shared/kernel/actor.ts`. Decided when the types are added (P25 step 2).

## 7. The access table

**First param today:** what the function takes after `db`. A flag means a plain `userId`,
`viewerId` or `ownerId` supplied by the caller. **Kind:** section 2. The test name carries the
row number (`R21: another player gets null`).

### 7A. Reads adapters call today (97, the 14 bundles)

| #   | Read                               | First param today            | Kind | Access rule a test pins                                                         |
| --- | ---------------------------------- | ---------------------------- | ---- | ------------------------------------------------------------------------------- |
| R1  | accounts.hasAnyPlayers             | none                         | V    | returns a boolean only; a visitor may call it                                   |
| R2  | accounts.listAccessTokens          | `userId` flag                | P    | lists only the actor's tokens                                                   |
| R3  | accounts.listInvites               | `now`                        | A    | a plain player is refused (type) and sees nothing                               |
| R4  | accounts.listPlayers               | none                         | A    | admin only                                                                      |
| R5  | activity.feed                      | `limit`, filter.actorId flag | S    | private-deck events hidden; "friends" scope = friends and self                  |
| R6  | catalog.enabledSets                | none                         | S    | same list for every signed-in player; visitor gets nothing                      |
| R7  | catalog.findSet                    | `code`                       | S    | a disabled set is hidden from players                                           |
| R8  | catalog.packPhotos                 | `packs`                      | S    | catalog data, signed-in only                                                    |
| R9  | catalog.productPhotos              | `productIds`                 | S    | catalog data, signed-in only                                                    |
| R10 | catalog.photosOverview             | none                         | A    | admin only                                                                      |
| R11 | catalog.setPhotos                  | `setCode`                    | A    | admin only                                                                      |
| R12 | catalog.listSetsForAdmin           | none                         | A    | admin only                                                                      |
| R13 | catalog.recentSyncRuns             | `limit`                      | A    | admin only                                                                      |
| R14 | catalog.searchPrintings            | `{ userId, ... }` flag       | P    | `own` counts are the actor's, never another player's                            |
| R15 | catalog.setPrintings               | `code`                       | S    | catalog data, signed-in only                                                    |
| R16 | catalog.priceHistory               | `id`                         | S    | catalog data, signed-in only                                                    |
| R17 | catalog.printingDetail             | `id`                         | S    | catalog data, signed-in only                                                    |
| R18 | collection.page                    | `userId` flag                | P    | only the actor's copies (the trade builder uses R86 + F5)                       |
| R19 | collection.ownedCopies             | `userId` flag                | P    | only the actor's copies                                                         |
| R20 | collection.exportRows              | `userId` flag                | P    | only the actor's rows                                                           |
| R21 | decks.deckView                     | `userId` flag                | P    | another player's deck id gives `null`                                           |
| R22 | decks.decksUsing                   | `userId` flag                | P    | counts only the actor's decks                                                   |
| R23 | decks.deckForViewer                | `viewerId` flag              | S    | owner, or deck shared; a private deck gives `null` to others                    |
| R24 | decks.comments                     | `deckId` flag (no check)     | S    | comments of a private deck give `[]` to others (SQL join, F2)                   |
| R25 | decks.decksFor                     | `userId` flag                | P    | only the actor's decks                                                          |
| R26 | decks.sharedDecks                  | none                         | S    | only `visibility = 'shared'` decks                                              |
| R27 | decks.cardsToGet                   | `userId` flag                | P    | built from the actor's decks only                                               |
| R28 | decks.commanderDetails             | `userId` flag                | P    | ownership figures are the actor's                                               |
| R29 | decks.commandersICanBuild          | `userId` flag                | P    | uses the actor's collection only                                                |
| R30 | decks.publicDeck                   | `token`                      | V    | wrong or revoked token gives `null`; a private deck without a token never shows |
| R31 | decks.publicScorecard              | `token`                      | V    | same as R30                                                                     |
| R32 | decks.tokenArtOptions              | `tokenOracleId`              | S    | catalog data, signed-in only                                                    |
| R33 | decks.listPreview                  | `userId` flag                | P    | another player's deck gives `null`                                              |
| R34 | decks.tokenLines                   | `deckId` flag (no check)     | V    | becomes `publicDeckTokens(token, ...)`; other decks give `[]` (F3)              |
| R35 | decks.browse                       | `userId` flag                | P    | other players' decks refused; only the actor's cards                            |
| R36 | decks.printingsOf                  | `userId` flag                | P    | another player's deck gives `null`/`[]`                                         |
| R37 | decks.otherDecksHolding            | `userId` flag                | P    | lists only the actor's other decks                                              |
| R38 | decks.suggestions                  | `userId` flag                | P    | another player's deck gives `null`                                              |
| R39 | decks.optimize                     | `userId` flag                | P    | another player's deck gives `null`                                              |
| R40 | decks.draft                        | `userId` flag                | P    | another player's deck gives `null`                                              |
| R41 | decks.similar                      | `userId` flag                | P    | another player's deck gives `null`                                              |
| R42 | decks.budgetList                   | `userId` flag                | P    | another player's deck gives `null`                                              |
| R43 | decks.snapshots                    | `userId` flag                | P    | another player's deck gives `null`                                              |
| R44 | decks.compareSnapshots             | `userId` flag                | P    | another player's deck or snapshot id gives `null`                               |
| R45 | drafts.boosters                    | none                         | S    | catalog data, signed-in only                                                    |
| R46 | drafts.boosterOptions              | none                         | S    | catalog data, signed-in only                                                    |
| R47 | drafts.overview                    | `userId` flag                | P    | the actor's drafts and open lobbies                                             |
| R48 | drafts.view                        | `draftId`, `userId` flag     | S    | any player sees the lobby; picks of others never (confirm, Q5)                  |
| R49 | drafts.activeDraftOf               | `userId` flag                | P    | the actor's draft only                                                          |
| R50 | drafts.version                     | `draftId` flag (no check)    | S    | a draft id the player may not view gives `null` (F4)                            |
| R51 | inventory.recentOpenings           | `userId` flag                | P    | only the actor's openings                                                       |
| R52 | inventory.unopenedItems            | `userId` flag                | P    | only the actor's items                                                          |
| R53 | inventory.openingView              | `userId` flag                | P    | another player's item id gives `null`                                           |
| R54 | packs.themes                       | `packs`                      | S    | catalog data, signed-in only                                                    |
| R55 | packs.availableBoosters            | none                         | S    | catalog data, signed-in only                                                    |
| R56 | realCollection.page                | `userId` flag                | S    | `(actor, ownerId)`: own, or owner shares; else empty (F1)                       |
| R57 | realCollection.sets                | `userId` flag                | S    | same as R56                                                                     |
| R58 | realCollection.productsOf          | `userId` flag                | S    | same as R56                                                                     |
| R59 | realCollection.isShared            | `userId` flag                | P    | the actor's own setting                                                         |
| R60 | realCollection.shared              | none                         | S    | only players with sharing on                                                    |
| R61 | realCollection.printingChoices     | `oracleIds`                  | S    | catalog data, signed-in only                                                    |
| R62 | realCollection.printingsOfSameCard | `printingId`                 | S    | catalog data, signed-in only                                                    |
| R63 | realCollection.copiesOf            | `userId` flag                | P    | only the actor's copies                                                         |
| R64 | realCollection.exportRows          | `userId` flag                | P    | only the actor's rows                                                           |
| R65 | realCollection.productCounts       | `userId` flag                | P    | only the actor's products                                                       |
| R66 | social.playerProfile               | `viewerId` flag              | S    | stats and wishlist sections follow their visibility vs the viewer's friendship  |
| R67 | social.profileForEdit              | `userId` flag (string)       | P    | the actor's own profile                                                         |
| R68 | social.incomingRequestCount        | `userId` flag (string)       | P    | requests addressed to the actor                                                 |
| R69 | social.friendRequests              | `userId` flag (string)       | P    | requests to or from the actor                                                   |
| R70 | social.friends                     | `userId` flag (string)       | P    | the actor's friends                                                             |
| R71 | social.searchPlayers               | `viewerId` flag (string)     | S    | active players only; the relation shown is to the viewer                        |
| R72 | store.page                         | `code`                       | S    | enabled sets only                                                               |
| R73 | store.packMsrps                    | none                         | S    | store data, signed-in only                                                      |
| R74 | store.singleHistory                | `userId` flag (string)       | P    | only the actor's transactions                                                   |
| R75 | store.buylistRate                  | none                         | S    | store data, signed-in only                                                      |
| R76 | store.pricingMode                  | none                         | S    | store data, signed-in only                                                      |
| R77 | store.kindPrices                   | none                         | A    | admin only (only the admin page calls it)                                       |
| R78 | store.msrpsBelowResale             | none                         | A    | admin only (same)                                                               |
| R79 | store.packPrice                    | `setCode`, `boosterType`     | S    | store data, signed-in only                                                      |
| R80 | store.productPrices                | `setCode`                    | A    | admin only (same as R77)                                                        |
| R81 | store.quoteShoppingList            | `userId` flag                | P    | quotes against the actor's copies                                               |
| R82 | store.search                       | `input`                      | S    | enabled sets only                                                               |
| R83 | trades.tradesFor                   | `userId` flag                | P    | only trades the actor is in                                                     |
| R84 | trades.waitingForYou               | `userId` flag                | P    | only trades addressed to the actor                                              |
| R85 | trades.view                        | `userId` flag                | P    | a trade the actor isn't in gives `null`                                         |
| R86 | trades.partners                    | `userId` flag                | S    | every active player except the actor                                            |
| R87 | wallet.economySettings             | none                         | S    | signed-in players read the allowance rules                                      |
| R88 | wallet.playerMoney                 | none                         | A    | every player's money: admin only                                                |
| R89 | wallet.history                     | `userId` flag                | P    | only the actor's ledger                                                         |
| R90 | wallet.summary                     | `userId` flag                | P    | only the actor's totals                                                         |
| R91 | wishlist.forCard                   | `userId` flag                | P    | only the actor's wishes                                                         |
| R92 | wishlist.isShared                  | `userId` flag                | P    | the actor's own setting                                                         |
| R93 | wishlist.sharedFor                 | `viewerId`, `ownerId` flag   | S    | owner not sharing gives `null`; no `targetCents`                                |
| R94 | wishlist.shared                    | none                         | S    | only players with sharing on                                                    |
| R95 | wishlist.wished                    | `userId` flag                | P    | only the actor's wishes                                                         |
| R96 | wishlist.atTarget                  | `userId` flag                | P    | only the actor's wishes                                                         |
| R97 | wishlist.answers                   | `userId` flag                | P    | only the actor's wishes                                                         |

**By kind:** P 47, S 36, A 10, V 4 (total 97). 47 P reads and the viewer-dependent S reads
(R5, R23, R48, R56 to R58, R66, R71, R86, R93) take a plain id today. In `social` and `store`
(R66 to R71, R74) that id is a bare `string`, not even a `UserId`.

### 7B. Reads only capabilities call (internal)

These stay `(db, userId, ...)`. Only a capability in the same module calls them, and it holds the
`Actor`. They are not in `queries/index.ts`, so section 6 step 6 doesn't apply. Each is tested
through its capability with two players (the binding tests). Not numbered.

`catalog`: `printingCards` (S), `lookupRules` (S), `storePrintingsOfCard` (P). `collection`:
`ownedByOracle` (P). `real-collection`: `realOwnedByOracle` (P). `decks`: `findCard` (S),
`deckSignalCards`, `ownedSignalCards`, `checkOwnedCards`, `listDeckSources`, `deckChangePreview`,
`manaBasePlan`, `searchForDeck`, `semanticSearchForDeck`, `budgetReplacements`, `auditDeck` (all P),
`getDeckProfile(viewerId, deckId)` (S, checks visibility in TypeScript), `combosForDeck`,
`comboPartnersForDeck`, `loadEdhrecSignals` (S). `wishlist`: `offersOf` (S), `ownedOf` (P).

## 8. The 17 whole services

Callers counted with `grep "capabilities\.<name>\."` in `src/app` (plus destructured uses). **None
of the 17 only reads.** So none moves to `reads`: each becomes a narrow capability in its module's
`wiring.ts`, listing only the methods callers use. The whole-service entry and `services` in
`core.ts` and `capabilities.ts` go away.

| Service          | Methods callers use                                                                                                                                                                                                                                            | Plan                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `deckSharing`    | setVisibility, enablePublicLink, rotatePublicLink, revokePublicLink, postComment, deleteComment                                                                                                                                                                | `decks` wiring: `sharing` (6)                                                                                        |
| `chooseToken`    | the function itself (1 caller)                                                                                                                                                                                                                                 | `decks` wiring: `chooseToken`                                                                                        |
| `proxySheet`     | the function itself (1 route, with progress)                                                                                                                                                                                                                   | `decks` wiring: `proxySheet`                                                                                         |
| `seeds`          | newSeed (3 pages)                                                                                                                                                                                                                                              | one `newSeed()` capability (randomness stays server-side)                                                            |
| `drafts`         | 17: createDraft, joinDraft, leaveDraft, startDraft, makePick, pickForAway, answerDeal, endDeals, chooseColor, decideCard, makeDraftDeck, addBot, removeBot, peekWithSneak, watchWithInformant, markPresence, **view**                                          | `drafts` wiring: `drafts` (17). `view(actor, draftId)` stays: it hides other seats' packs, a rule.                   |
| `realCollection` | addRealProduct, removeRealProduct, setRealCopies, changeRealPrinting, clearRealCollection, previewImport, applyImport, setRealSharing                                                                                                                          | `real-collection` wiring (8)                                                                                         |
| `store`          | buySingle, sellSingle, buySealed, buyList; admin: setBuylistRate, setKindPrice, setPricingMode, setProductPrice                                                                                                                                                | `store` wiring (8); the 4 admin ones take `AdminActor`                                                               |
| `inventory`      | openItem, openAll                                                                                                                                                                                                                                              | `inventory` wiring (2)                                                                                               |
| `accounts`       | signIn, signOut, registerPlayer, actorFromToken, changeOwnPassword, createAccessToken, revokeAccessToken, createInvite, revokeInvite, setAdmin, setDisabled, setSelfFunding, resetPassword, checkAuthorizationRequest, approveAuthorization, denyAuthorization | `accounts` wiring (16); the admin ones take `AdminActor`; `signIn`, `registerPlayer`, `signOut` are the visitor ones |
| `wallet`         | refreshWallet (3 callers), refreshAllWallets, addOwnFunds, grantMoney, correctBalance, updateEconomySettings                                                                                                                                                   | `wallet` wiring (6); `refreshWallet` takes `Actor` (F7); the admin ones `AdminActor`                                 |
| `social`         | sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, unfriend, updateProfile                                                                                                                                                     | `social` wiring (6)                                                                                                  |
| `trades`         | proposeTrade, counterTrade, acceptTrade, declineTrade, cancelTrade                                                                                                                                                                                             | `trades` wiring (5)                                                                                                  |
| `wishlist`       | addWish, removeWish, updateWish, buyWish, setSharing, wishForCards                                                                                                                                                                                             | `wishlist` wiring (6); `addWish`/`removeWish` duplicate `addWishes`/`removeWishes`, so merge to one                  |
| `catalog`        | imageFor, artworkFor (routes, no player); choosePhoto, clearPhotoChoice, enableStandardSets, requestSync, setPageSlug, setSetEnabled                                                                                                                           | `catalog` wiring (8): the two route ones stay for `readCapabilities()`; the six admin ones take `AdminActor`         |
| `packs`          | simulateOpenings (1 admin page)                                                                                                                                                                                                                                | `packs` wiring (1), `AdminActor`                                                                                     |
| `resetPlayer`    | the function (account page and admin players)                                                                                                                                                                                                                  | `reset` wiring, new `wiring.ts` (P25 step 5)                                                                         |
| `appUrl`         | a string (3 callers)                                                                                                                                                                                                                                           | `site.appUrl`; `headerSummary(actor)` lives in `site` too (below)                                                    |

`deckEdits` (the whole `Decks` service) becomes 19 named methods, the ones the builder calls:
createDeck, createDeckFromCards, copyDeck, deleteDeck, updateDeck, addCards, setEntry,
setEntryDetails, setEntryNote, setEntryHeading, moveEntry, importList, replaceList, choosePrinting,
renameHeading, orderHeadings, saveSnapshot, restoreSnapshot, deleteSnapshot.

**`headerSummary`** stays a capability (`site.headerSummary(actor)`), because it calls
`refreshWallet`, which pays any allowance due. That is a write inside a read. It takes the `Actor`,
and builds its other four numbers from `reads` (`waitingForYou`, `atTarget`, `activeDraftOf`,
`incomingRequestCount`). The cross-module capabilities (`rulesLookup`, `lookUpCards`,
`searchCatalog`) stay capabilities and take the readers they need from `reads`.

**Size:** the lists move into module wirings (about 113 names). `capabilities.ts` only joins the
module results and ends at or under 120 lines, as P25 asks.

## 9. `formAction`

`src/server/form-action.ts`, next to `action.ts`, built the same way (`makeFormAction(sources)`
for fakes, a real instance in `form-action-instance.ts`).

```ts
export const saveProfileAction = formAction(
  ProfileSchema,
  async ({ actor, capabilities }, input) => capabilities.social.updateProfile(actor, input),
  { describeError: describeSocialError, redirectTo: "/account/profile" },
);
```

- **Signature.** The returned function takes the form's `FormData` as its **last** argument and an
  optional `FormState` first. So it works for `useActionState(action, initial)` and for a plain
  `<form action={action}>`.
- **Reading.** `Object.fromEntries` loses repeated keys, so the reader walks the schema's top
  level instead. A key whose schema is an array (`z.array(...)`, even optional or defaulted) is read
  with `getAll(key)`. Every other key uses `get(key)`. Unknown keys are ignored. A `File` where a
  string is expected is an issue.
- **Checkboxes.** An unchecked box is absent, a checked one is `"on"`. The module exports
  `checkbox()`, which is `z.preprocess((value) => value === "on", z.boolean())`. A missing key is
  `false`. `formData.get("shared") === "on"` (5 files) goes away.
- **Blank text.** `""` stays `""`. A schema that wants "none" for a blank field uses `blankAsUndefined()`,
  also exported. No other coercion: numbers use `z.coerce.number()` in the schema, where a newcomer
  can see it.
- **Session.** The same `sources.requireActor()` as `action()` (signed-out visitors go to
  `/sign-in`; a player who must change a password goes to that page). `{ admin: true }` as the last
  option uses `requireAdminActor()` and passes an `AdminActor`.
- **Error path.**
  1. Invalid input gives `{ message: "field: problem; ...", tone: "error" }` (the issues, joined,
     the same text `action()` builds). The handler isn't called.
  2. The handler returns a `Result`. `ok` gives `{ message: successText, tone: "success" }`, or
     redirects when `redirectTo` is set. `err` gives `describeError(error)` as the message.
  3. A thrown defect isn't caught: it reaches Next's error page (the rule: defects throw).
  4. `redirect()` and `notFound()` throw by design. `formAction` doesn't catch them.
- **State shape.** One `FormState = { message: string | null; tone: "error" | "success" | null }`
  replaces `{ error }`, `{ message, tone }` and the other per-form shapes (open question 7).
- **Tests.** With fakes, like `action.test.ts`: repeated keys, unchecked box, invalid input, a
  `Result` error, a redirect, a signed-out call.
- **Migration.** 32 files read `FormData`. Each area is one commit that deletes that file's hand
  parsing. `describe-error.ts` files come first for `drafts`, `wishlist`, `trades`, `singles` and
  `cards` (P25 step 7), so each `formAction` has its `describeError`.

## 10. Security findings

I read every query reachable from a page, action or route. **Nothing below is fixed.** The rows
marked "not reachable today" can't be used by a player now, but only because a page checks first.

| ID  | Where                                                                                                                                                                                                                                                                                                                                                       | What a player could see                                                                                                                                                                                                             | Reachable today?             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| F1  | `real-collection/queries/real-collection.ts:43` (`realCollectionPage`), `:98` (`realProductsOf`), `:130` (`realCollectionSets`) take any `userId`. The share check is in the page: `app/players/[id]/real/page.tsx:18-24`                                                                                                                                   | another player's **real** collection if they hadn't shared it, for any caller that skips the page's check                                                                                                                           | no                           |
| F2  | `decks/queries/sharing.ts:109` (`deckComments(deckId)`): no visibility check. The only check is `app/decks/[id]/page.tsx:35-39`                                                                                                                                                                                                                             | the comments on a **private** deck                                                                                                                                                                                                  | no                           |
| F3  | `decks/queries/tokens.ts:59` (`deckTokenLines(deckId, ...)`): no check; called from `app/d/[token]/page.tsx:33`                                                                                                                                                                                                                                             | the token-art choices of any deck, given its numeric id                                                                                                                                                                             | no                           |
| F4  | `drafts/queries/drafts.ts:160` (`draftVersion(draftId)`), used by `app/api/drafts/[id]/events/route.ts:19`; and `:213` (`draftView`)                                                                                                                                                                                                                        | any signed-in player can poll the version of any draft and open its lobby (host, seats, fee). Others' packs stay hidden (`drafts.view`). Design doc 17 rule 13 covers packs only                                                    | yes, probably by design (Q5) |
| F5  | `app/trades/new/page.tsx:134-138` calls `collection.page(partner.userId, ...)`; the partners are every active player (`trades/queries/trades.ts:11`)                                                                                                                                                                                                        | any signed-in player can read and search any other player's whole **game** collection and its value. Design doc 10 rule 2 (lines 118, 142) says collections are visible in the trade builder, but doc 10 doesn't say it is everyone | yes, as designed (Q3)        |
| F6  | Visibility tested in TypeScript after the row is fetched: `decks/queries/sharing.ts:33-51` (`deckForViewer`, `canViewDeck`), `decks/queries/deck-profile.ts:7,28`, `social/queries/profile.ts:73` (`canViewSection`), `wishlist/queries/wishlist.ts:155-170`                                                                                                | nothing leaks today; but each is a place where a changed query could skip the test                                                                                                                                                  | no                           |
| F7  | Capabilities that trust a caller's `userId`: `refreshWallet(userId)` (`server/capabilities.ts:67`), `deckOverview({ userId })` (called with the **owner's** id at `app/decks/[id]/page.tsx:53`, after `deckForViewer`), `checkOwnedCards({ userId })` (`decks/wiring.ts:197`), `wishlistView({ userId })` (`app/_llm-tools/bindings/manage-wishlist.ts:72`) | `deckOverview` returns the owner's view of a deck; only `deckForViewer` stops a stranger. `refreshWallet(userId)` would pay allowance into any wallet                                                                               | no                           |
| F8  | `catalog/queries/catalog.ts:220,251`: `PrintingSearch.userId` is inside the input object; `activity/queries/feed.ts:92`: `filter.actorId`                                                                                                                                                                                                                   | the `own` search term and the "friends" feed would use whatever id the caller gives; both pages pass `actor.userId` today                                                                                                           | no                           |
| F9  | `src/proxy.ts:11` makes `/api/images/` public, and `api/images/.../route.ts:22` checks no one; `imageFor` fetches from Scryfall on a cache miss (`catalog/application/admin.ts:123`)                                                                                                                                                                        | a visitor can fetch any card image, and can make the server fetch one it hasn't cached (existing printings only). The route's comment says "private" cache                                                                          | yes (low)                    |
| F10 | `src/proxy.ts:24` only checks that a session cookie **exists**; `api/artwork/[imageId]/[size]/route.ts:18` checks nothing else                                                                                                                                                                                                                              | anyone with any cookie value can fetch product photos (public WPN images)                                                                                                                                                           | yes (low)                    |
| F11 | `decks/queries/deck-profile.ts:41,80` and `decks/queries/decks.ts:457` **write** from `queries/` with an `ownerId` argument (ADR 0006 says queries never write)                                                                                                                                                                                             | nothing now: capabilities pass the actor's id. A write that takes an id from the caller is the riskiest shape                                                                                                                       | no                           |

What I checked and found fine: every `deckView`-based decks query filters `owner_id = $userId`
(`decks.ts:136-151`); `tradeView` and `tradesFor` filter by participant (`trades.ts:157-175`);
`openingView`, `singleHistory`, `listAccessTokens` filter by the user; `sharedWishlistFor` hides
`targetCents`; the draft change previews filter by `userId` (`deck-change-preview` repository).

## 11. Test plan

- **`tests/integration/access-rules.int.test.ts`:** one test per row of 7A, named with its
  number. P and S rows: another signed-in player gets `null` or empty; a visitor can't call it (a
  `// @ts-expect-error` line plus a runtime call through `PublicReads`). Shared deck: shown to the
  playgroup, private one isn't. A rows: a plain player's call is refused by the type, and
  `readPage({ admin: true })` sends a plain player to "not found" (already tested in `page.test.ts`).
- **Unit:** `bindDb`, `readPage` with the three modes, `formAction` (section 9), the `NoPlainUserId`
  type checks (they fail typecheck, not the test run).
- **Existing:** the capability tests with fakes don't change. The tool binding tests keep two
  players where they have them.
- Run `test:int` and e2e at the end of P25, as the package says (not during this step).

## 12. Open questions

1. **`bindDb` or plain functions?** Options: A `bindDb` (recommended), B plain, C factories.
   Recommend A, with the activity-module click-through check and B as the fallback (section 4).
2. **Actor explicit or bound?** Options: (a) `reads.decks.deckView(actor, id)`; (b) `readPage()`
   returns `reads` already bound to the actor, so `reads.decks.deckView(id)`. Recommend (a): the
   reviewer sees who each read is for, and S reads that take an `ownerId` stay obvious. (b) is
   shorter at the call site but hides the rule.
3. **Whole game collections visible to every player (F5).** Options: (a) keep, and write it as
   a named S read `collection.pageOfPartner(actor, partnerId)`; (b) only friends or players
   you've traded with; (c) only after a proposal exists. Recommend (a): doc 10 chose it and I'm
   told not to change behaviour. Please confirm it is meant for _every_ player.
4. **Public image routes (F9, F10).** Options: (a) keep public, add "the printing exists" (already
   true) and a size or rate limit; (b) require a valid session on `/api/images` and let the public
   deck page use a token-signed image path; (c) check the session on `/api/artwork` and fix the
   comment. Recommend (c) now and (a); (b) is more work for little gain.
5. **Drafts visible to everyone (F4).** Options: (a) keep, as written in the R48 and R50 rules;
   (b) only players in the draft or the host's friends; (c) fix only `draftVersion` so it requires
   the same rule as `view`. Recommend (a) with (c): same rule in both reads.
6. **Where the visibility rule lives (F6).** Options: (a) SQL only; (b) TypeScript only, as now;
   (c) SQL in the query, plus the pure `canViewDeck`/`canViewSection` kept for capabilities, and a
   test that both agree. Recommend (c): "secure by construction" needs the SQL, and the domain
   functions are already tested.
7. **One `FormState` shape for every form.** Options: (a) one `{ message, tone }`; (b) keep each
   form's own shape and let `formAction` take a mapper. Recommend (a): about 20 forms change, each
   by a few lines. It does touch the form components (not their look).
8. **`PublicReads` as a type for visitors.** Options: (a) a type subset (can't call a P read at
   all); (b) full `reads` with a runtime "actor is null" error. Recommend (a).
9. **Writes inside `queries/` (F11).** Options: (a) move the three functions to `decks/application`
   in P25's decks commit; (b) leave for P18, the decks split. Recommend (b), as P25 is about reads
   and P18 reorganizes the folder anyway.
10. **Actor type in `accounts` or the kernel.** Options: (a) keep in `accounts`, import the type
    elsewhere; (b) move `Actor` and `AdminActor` to `@/shared/kernel`. Recommend (a) unless the
    cycle check objects (section 6).

## 13. Not sure about

- The click-through of `bindDb` (section 4): untested.
- The `PublicReads` union narrowing when destructured. TypeScript supports it, but I haven't
  compiled this exact shape.
- Whether 16 test files need the test helper, or whether some can keep a shared fixture.
- The counts are by grep and reading. `deckReads` has 24 members, not the 25 in P25's text.
