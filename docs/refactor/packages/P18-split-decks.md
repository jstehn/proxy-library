# P18. Split `decks` into responsibility subfolders

> **Decision 4 answered (2026-11-19):** one `decks/` module with responsibility subfolders (not four modules).
>
> **Revised by the plan review.** Subfolders import each other **only through each subfolder's `index.ts`** (a lint rule; report 1, option C). **Advice splits into scoring and building**, so every folder is ≤ 12 files (owner answer D4: yes). **`draft-deck` is renamed `build-from-collection`**, so nobody confuses it with the `drafts` module. The package now **depends on P29**, which breaks the import cycles first.

- **Branch:** `refactor/P18-split-decks` (step branches `refactor/P18.k-<area>`) · **Depends on:** P29 (and P11–P17, P26, P27, P28 through it) · **Parallel with:** none (moves files everywhere)
- **Audit:** doc 65 F1; [plan review](../reviews/plan-review/README.md) reports [1](../reviews/plan-review/1-architecture.md) and [4](../reviews/plan-review/4-domain-engines.md) · **Starts wave 5**
- **Lines:** none to remove; net about 0. It moves files, and each subfolder gains a small `index.ts` (a few lines each) while the 78-export `decks/index.ts` shrinks.

## Goal

`decks` stops being one folder of 179 files. Each responsibility is a subfolder with a short public
API, no folder has more than 12 source files, and the lint rule keeps it so.

## Deletes

| What                                                                                                                                                                    | Where                                                | Lines          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------- |
| The wide public API: `decks/index.ts` (225 lines, 77 exports today; 78 per the review) and `client.ts` (28 exports) shrink to re-exports of each subfolder's `index.ts` | `src/modules/decks/{index,client}.ts`                | −100 to −150   |
| Exports nothing outside uses (re-check with knip)                                                                                                                       | each new `index.ts`                                  | −30 to −60     |
| The `draft-deck` name, in file names, functions and docs (`draftDeck`, `draft-deck.ts`, `draft-deck.test.ts`, `queries/draft-deck.ts`, the integration test name)       | `decks/domain/draft-deck.ts` (789 lines) and friends | rename         |
| The "Added from P07b2" leftover: `queries/suggestions.ts` and `budget-replacements.ts` orchestration moves to `application/suggest-cards.ts` (below)                    | `decks/queries/`                                     | net −20 to −50 |
| The `draft-deck.ts` oversize allowlist entry, if P28 split it                                                                                                           | `docs/refactor/oversize-allowlist.txt`               | —              |

## Touches

All of `src/modules/decks/`, `eslint.config.mjs` (boundaries and the new rule), `src/server/*`,
`src/modules/*/wiring.ts` that import decks, imports across `src/app` and the tool bindings,
`docs/architecture/overview.md` (module table and graph), new `docs/adr/0028-split-decks.md`.

## Steps

1. **ADR 0028.** The areas and what each holds (propose from the cluster map in
   [report 4](../reviews/plan-review/4-domain-engines.md), and count files after P24–P28, which
   shrank the play area):
   - **`core`:** lists, legality, headings, boards, stats, snapshots, sharing, formats,
     commanders.
   - **`scoring`:** `rate`, `signals`, `suggest` scoring, `cuts`, `swaps`, `replacements`,
     `optimize`.
   - **`building`:** `build-from-collection` (was `draft-deck`), `mana-base`, `commanders` builder,
     candidate pool, suggestion orchestration, audit report.
   - **`play`:** `opening-hand`, `goldfish` (odds), `castability`, `mana-payment`, `cast-effects`,
     `draws`.
   - **`proxies`:** `proxy-sheet`, `playtest-card`, `token-proxies`, `proxy-progress`.
     Draw the allowed arrows (for example `building` → `scoring` → `core`; `play` → `core`;
     `proxies` → `core`; nothing → `building`). Layer folders (ADR 0001) stay inside each area. Where
     a layer folder still has more than 12 files, that is a sixth responsibility: say so in the ADR.
     Count files with `pnpm sizes` ("Folders with the most source files") before and after.
2. **Move files with `git mv`, one area per commit**, `core` last. Each area gets its `index.ts`
   (and `client.ts` if the browser needs pure code from it, ADR 0016) and `testing/` if it has
   fakes. **Don't leave a re-export at the old path.**
3. **Rename `draft-deck` to `build-from-collection`** in the same commit that moves it:
   `draftDeck` → `buildFromCollection`, the tool and page labels stay (what the player reads
   doesn't change), the integration test file and the `docs/` mentions follow.
4. **The lint rule.** In `eslint.config.mjs`: inside `src/modules/decks/<area>/**`, importing a
   file in another area is an error unless it is that area's `index.ts` (or `client.ts` from
   client code). Add the arrows from the ADR as an allowed list. Other modules import only
   `@/modules/decks` (the module `index.ts`) as before.
5. **Update the cycle check** (`scripts/dev/check-cycles.ts --modules`, from P29) to treat each area as
   a node. The module-cycle baseline stays empty.
6. **The P07b2 leftover:** move the suggestion orchestration (`deckSuggestions`, `similarCards`,
   `budgetList`, `budgetReplacements` in `queries/suggestions.ts` and `budget-replacements.ts`)
   into `building/application/suggest-cards.ts` behind a `CandidatePool` port, with fake-pool unit
   tests. It brings `queries/optimize.ts` (it calls `deckSuggestions`) and the `BrowseCard` /
   `SuggestionCard` types (to `domain/`) with it. (`queries/upgrade-roadmap.ts` went in P24.)
   See the P07b2 handoff.
7. Update `docs/architecture/overview.md` (module table and graph), and remove the allowlist
   entries of moved files that fell under 500 lines.
8. `pnpm check`, `pnpm test:int`, `pnpm test:e2e` (every page imports decks). `pnpm sizes --update`.

## What not to do

- Don't split into four modules (decision 4).
- Don't add `index.ts` files that re-export everything: each exports only what other areas use.
- Don't rename anything except `draft-deck`.
- Don't change behaviour.

## Done when

- `pnpm check` is green, including the cycle check and the new subfolder rule.
- Every area's `index.ts` is under 150 lines, `decks/index.ts` is under 150, and no folder has more
  than 12 source files (`pnpm sizes`, "Folders with the most source files").
- `grep -rn "draft-deck\|draftDeck" src tests docs --include='*.ts' --include='*.tsx' --include='*.md' -l`
  finds only history (the ADR, the change logs, old design docs).
- Milestone 3 can start once P30 is done.

## Needs the owner

- Approve ADR 0028's area names and arrows. The plan fixes the principle (decisions 4 and D4); the
  names are the owner's to confirm.

## Handoff

**Done, with two things for the owner:** the ADR is **0029** (0028 is P35's); and production code is
**+132** (75,505 to 75,637), so the `sizes` ratchet needs approval. `core/domain` and
`core/application` have 20 source files each, over the 12-file rule (see below).

**Areas** (`src/modules/decks/<area>/{domain,application,infrastructure,queries,testing}`, plus the
area's `index.ts` and `client.ts`): `core` 54 files, `scoring` 9, `building` 21, `play` 8, `proxies`
15, `overview` 8 (a sixth area the plan did not name: the files that combine areas). Root:
`index.ts` (8 lines) and `client.ts` (6) are `export *` of the areas; `wiring.ts`;
`infrastructure/index.ts`. Arrows: `scoring`, `play`, `proxies` → `core`; `building` → `core`,
`scoring`, `play`; `overview` → all; `core` → none.

**The rule** (`eslint.config.mjs`, `DECKS_ARROWS` at the top): a decks file imports another area
only through `<area>/index.ts` or `<area>/client.ts`, along the arrows; `<area>/testing/*` and
`<area>/infrastructure/schema.ts` are open to all (fakes, table definitions). Domain files import
`client.ts` only, `client.ts` imports domain only. The area names are in `DECKS_ARROWS`, in
`DECKS_AREAS` in `scripts/dev/check-cycles.ts` and in the folder names (and `scripts/dev/regex-count.ts`).
**The cycle check** treats each area as a node (`decks/<area>`); the baseline is still empty.

**Moves worth knowing.** `ports.ts` lost the proxy ports (now `proxies/application/ports.ts`), and the
token and image fakes went to `proxies/testing/fakes.ts`, so `core` never imports `proxies`.
`lineToOptimizerCard` moved to `scoring/domain/optimize.ts`; the optimizer read
(`optimizeDeckForView`) is in `overview/queries/optimize.ts` (it joins the deck view and the
suggestions; `queries` may not import `application`). `ManaSource` exists twice (`mana-payment` and
`stats`); `core/client.ts` exports the payment one as `PaymentSource`.

**`draft-deck`** is `build-from-collection` (domain, query, tests, integration test); `draftDeck` is
`buildFromCollection`; `draftDeckAction` is `buildFromCollectionAction`. `draftForDeck`,
`DeckDraft` and the tool and page labels are unchanged.

**The P07b2 leftover.** `building/application/suggest-cards.ts` holds `deckSuggestions`,
`similarCards`, `budgetList`, `budgetReplacements`; each takes a `CandidatePool` (declared in
`building/domain/suggestion-types.ts`, implemented by `candidatePool(db, userId)` in
`building/queries/suggestion-pool.ts`, with `suggestionContext`). Same SQL, same order of calls;
fake-pool tests in `suggest-cards.test.ts`. The integration tests call
`deckSuggestions(candidatePool(db, userId), deckId)`.

**Checks.** `pnpm check`: all green but `sizes`. Unit 1,721; integration 363/363 on a private
database. Playwright was not run (not allowed here). knip baseline 380 to 300.

**Left over.** (1) `core/domain` 20 and `core/application` 20 files: sharing and changes (previews,
snapshots) are separable in principle, but `ports.ts`, `make-decks.ts`, `drizzle-repositories.ts`
and the fakes reference both; needs the owner's area names. (2) `core/queries` has 8, all others
are at 12 or fewer. (3) Lessons that mention old paths were not touched (deferred).
