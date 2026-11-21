# Plan review 1: architecture and module boundaries

Read-only review by an agent, 2026-11-19, on `refactor/main` at `48f18af`. It ran `pnpm sizes` and
`pnpm clones`.

**Measured:** 79,270 code lines.

- `decks`: 35.5k lines in 179 files (`domain` 91, `application` 45, `queries` 27).
- `catalog`: 11k lines.

## Findings, ranked

1. **The capability layer is half done.**
   - `capabilities.ts` spreads 13 `wire*` results plus whole services (17 of them, including
     `deckEdits`, which is all of `Decks`).
   - So `Capabilities` is a bag of about 120 names, and the app uses 55 of them (`deckEdits` 23
     times, `drafts` 16).
2. **Two patterns, and nothing says which one wins.**
   - There are 13 `*Reads` bundles. `deckReads` alone has 25 members.
   - About half are `withDb` forwards. The rest are hand-written lambdas that only restate a query's
     signature.
3. **`decks` is five jobs behind one public API.** `index.ts` has 78 exports and `client.ts` 28.
4. **`catalog` is three jobs in one module:**
   - card data: sync, prices, images
   - the comprehensive rules: `rules.ts`, `rules-lookup.ts`, `related-rules.ts` and
     `drizzle-rules.ts`
   - outside deck data: EDHREC, Commander Spellbook, embeddings and WPN

   P20 only says "check".

5. **Query files join other modules' tables.** ADR 0006 allows it for reads.
   - Catalog's schema is imported by 9 query files, accounts' schema by 4.
   - `social` imports `decks`' schema.
6. **Possible module cycles through `wiring.ts`.** `wiring.ts` is exempt from the layer rules, which
   is how these slip through.
   - `accounts` imports `decks`, while `decks` imports `accounts` 17 times.
   - `catalog` and `accounts` import each other.
   - `drafts` imports `decks` in 7 places, and `decks` imports `activity`.
7. **`shared/card-search` is module code in disguise** (5.1k lines). `tags`, `signals` and
   `brackets` are deck rules, and `sql*.ts` is catalog SQL. Only the query language (`parse`, `list`,
   `help`) is truly shared.
8. **`shared/kernel` mixes general basics with Magic vocabulary** (`card-types`, `colors`,
   `mana-curve`). Either say so, or move the Magic part to `shared/mtg`.
9. **There are two ways to write a server action:** 84 `readPage(` inside `actions.ts` files, and 28
   `action(`.
10. **Loose ends:**
    - `reddit`, `youtube` and `reset` have no `wiring.ts`.
    - `headerSummary` is composed in `capabilities.ts`.
    - `collection` and `real-collection` are two modules for one idea.

## Options it gives for the capability contract

- **Option 1: an honest read layer (CQRS).** Reads are each module's `queries`, `(db, …)` functions,
  never capabilities. Writes and orchestration are capabilities.
- **Option 2: reads become real capabilities.** A generic `bindDb(queries)` binds the database once,
  in place of the restating lambdas.
- **Either way:** remove the whole-service pass-through, and give `reddit`, `youtube` and `reset`
  their own wiring.

## P18

It weighs three ways to split `decks` and leans to C:

- **A:** one module with four subfolders (decision 4).
- **B:** four separate modules.
- **C:** A, plus a rule that the subfolders import each other only through their own `index.ts`.

## Plan changes it suggests

- **Before P18:** an ADR 0026 addendum that picks Option 1 or 2.
- **After P18, before P20:** remove the service pass-through.
- **Before P18:** move `reddit` and `youtube` into `research/`.
- **New packages:**
  - split `catalog`
  - give `card-search` SQL, tags and signals a final home
  - break the `accounts`/`decks` cycle, with a cycle check that covers `wiring.ts`

## Questions for the owner

- May pages see `db` through a documented read layer?
- `collection` and `real-collection`: one module with two stores, or separate by design?
- Are the dead-code candidates kept on principle ("no feature cuts")?
- A small `bindDb` helper, or every read a function a newcomer can click through?
