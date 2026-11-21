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

| What                                                                                                                                                                                                                                            | Where                                | Why it exists                                                                                              | Remove in                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `readPage()` and hand-written FormData parsing in the actions that keep them (list in the P25 handoff, "Part 2c"): forms that redirect with `?error=`, `{ error }` forms with extra state, and the plain `<form action>` ones                   | `app/**/actions.ts`                  | `formAction` returns a state, so a `<form action>` that always redirects needs a redirecting variant of it | **the project manager decides** (a redirecting variant of `formAction`, or P32 with its page states) |
| `rulesLookup`, `lookUpCards`, `searchCatalog` joined in `capabilities.ts`                                                                                                                                                                       | `src/server/capabilities.ts`         | they read across modules; no one module's wiring may hold them                                             | **P30** (the catalog split and the collection merge decide where they live; replaces "P18")          |
| `printingDetails` beside `lookUpCards`'s `detail`                                                                                                                                                                                               | `capabilities.ts`                    | two readers of printing details                                                                            | **P30** (replaces "P20")                                                                             |
| `readCapabilities()` for routes that don't resolve a player (images, artwork, OpenAPI, the tool endpoints)                                                                                                                                      | `src/server/page-instance.ts`        | routes without a signed-in player                                                                          | keep (P25's design doc names it)                                                                     |
| `REGEX_ALLOWED` (was `NOT_YET_RECOGNIZED`): `decks/core/domain/rules.ts` keeps commander, partner and copy-limit regexes over `CardRules.text`; moving them needs a commander-rules feature on every `CardRules` loader (FEATURES_VERSION bump) | `eslint-rules/oracle-text-regex.mjs` | the commander rules are read from card text on the browser too                                             | the owner's decision (own feature)                                                                   |
| `knip.json` ignore: every moved module's `queries/*.ts` exports (knip can't see `reads.<module>.<query>` through `bindDb`; without it 100 findings come back)                                                                                   | `knip.json`                          | knip traces neither `Object.entries(namespace)` nor `bindDb`                                               | **P30** (the structure is final), or a knip plugin that follows `bindDb`                             |

## Added by the plan revision (temporary on purpose)

| What                                                                                                                                                                                                                         | Where                        | Added by | Remove in                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `knip-baseline.txt` and `scripts/dev/knip-ratchet.sh`: `knip --production` is a ratchet gate (findings may fall, never rise); 457 findings were left, mostly `index.ts` re-exports and types that only integration tests use | `docs/refactor/`, `scripts/` | P24      | P30 (the structure is final), or when the count reaches 0 and the gate becomes plain `knip` |
| The `knip.json` entries: `**/testing/**` and `tests/**` (test support is not production code), `ignoreExportsUsedInFile`                                                                                                     | `knip.json`                  | P24      | P30, or when the reason is gone                                                             |
| `regex-baseline.txt` (a ratchet, stays)                                                                                                                                                                                      | `docs/refactor/`             | P11      | archived with `docs/refactor/`                                                              |
| `module-cycles-baseline.txt` (must reach empty)                                                                                                                                                                              | `docs/refactor/`             | P29      | P29                                                                                         |
| `NOT_YET_ON_BLOCKS`: files allowed to keep long class strings                                                                                                                                                                | `eslint.config.mjs`          | P31      | P31 (empty at the end)                                                                      |
| The last commit that had `sim-pipeline.ts`: `156a971` (refactor/main before P24), for P28 to read                                                                                                                            | P24 handoff                  | P24      | P28                                                                                         |

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

| 20 action files still reading `formData.get` by hand (P25 Part 2c, "Kept as they were") | `src/app/**/actions.ts` | P32, step 9 |
