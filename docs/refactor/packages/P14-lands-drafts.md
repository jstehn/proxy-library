# P14. Lands, tokens and draft cards from features (sliced by ability)

- **Branch:** `refactor/P14-lands-drafts` (one step branch per slice: `refactor/P14.k-<ability>`) · **Depends on:** P11 · **Parallel with:** P12, P13
- **Audit:** doc 65 D4, F4; [plan review](../reviews/plan-review/README.md) report [4](../reviews/plan-review/4-domain-engines.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S3](../dedup-playbook.md#s3) (lands, draft abilities)
- **Lines:** about −150 to −400 (P12 to P14 together: −700 to −1,500). **A slice merges only at net ≤ 0.**

> **Changed by the plan review.** Sliced by ability; each slice deletes its old code. **`cardTypes`
> is not deleted any more:** P26 keeps it as the pure type-line helper (owner answer D2), and the
> features cover oracle-text facts only. The old step "point `cardTypes` callers at features" is gone.

## Goal

Land-related text facts (cycles, enters tapped, fetch) and token making come from `CardFeatures`,
and the drafts module names no card in code.

## Deletes

| Slice                                                                     | Old code that goes                                                                                                                                                                                | Lines       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. **Land cycles** (a stored `land_cycles` array, doc 66 open question 9) | the land-cycle matchers in `decks/domain/{mana-base,stats,rules}.ts` (5 regexes in `rules.ts`, 2 in `stats.ts`)                                                                                   | −60 to −150 |
| 2. **Token making** (what a card creates)                                 | the matchers in `decks/domain/token-proxies.ts` (2 regexes) and any copy in `decks/application/token-choices.ts`                                                                                  | −30 to −80  |
| 3. **Draft abilities** (`name === "Cogwork Librarian"`)                   | `drafts/domain/timers.ts:177` (verify the line) and the one regex in `abilities.ts`; replaced by one `DRAFT_ABILITIES` data table keyed by name (not a text recognizer: doc 66 section 7 says so) | −20 to −60  |
| 4. **The lint rule**                                                      | none (it adds ~10 lines)                                                                                                                                                                          | +10         |

## Touches

`src/modules/decks/domain/{mana-base,stats,rules,token-proxies}.ts`,
`src/modules/decks/application/token-choices.ts`,
`src/modules/drafts/domain/{timers,abilities,auto-pick}.ts`, `eslint.config.mjs`, new recognizers,
`regex-baseline.txt`, `NOT_YET_RECOGNIZED`. **Avoid** `src/shared/kernel/card-types.ts` (P26),
the mana files (P12) and the tag files (P13).

## Steps

**Start from P12's slice 4** (project manager, 2026-11-20). P12 found its other slices already done
by P11. Its one real slice, the `enters-tapped` and `helps-opponents` recognizers, is built on
branch `refactor/P12.4-enters-tapped-wip` (commit ebe2d60: A2 compare 0 differences over 32 fixture
cards, `FEATURES_VERSION` 2, net +42 lines). It shares the land-feature loading this package
needs, so merge that branch first and make the combined package end at net ≤ 0. Also take P12's
leftover: the `blitz` keyword read in `deck-profile.ts` moves onto the keywords feature.

1. For each slice, as in P12: branch, recognizer with fixtures from the current tests, switch every
   caller, **delete the old code in the same commit**, lower the regex baseline, check the net.
2. Slice 3: add `DRAFT_ABILITIES` (`{ "Cogwork Librarian": { kind: "extraCard" } }`) and read it in
   `timers.ts`. The lookup is data, so adding an ability needs no new branch.
3. Slice 4: add a lint rule forbidding `name === "<literal>"` and `name !== "<literal>"` in
   `src/modules/**/domain`, with the `DRAFT_ABILITIES` file as the one place a name is a key.
4. `pnpm check`, `pnpm test:int` (drafts have integration tests), `pnpm sizes --update`.

## What not to do

- Don't delete or change `cardTypes` or `isLand`: they are P26's pure helpers.
- Don't add a recognizer for type lines.
- Don't turn the Cogwork Librarian rule into a regex: it is keyed by name on purpose.

## Done when

- `grep -rn 'name === "' src/modules --include='*.ts' | grep -v test` finds no card names.
- The regex baseline is lower; every slice's net lines were ≤ 0 (or approved).
- `pnpm check` and `pnpm test:int` are green.

## Handoff

**Branch** `refactor/P14-lands-drafts` (P12's `enters-tapped` slice merged first; commits P14.1 to P14.4).
**Package net: +35 production lines against `refactor/main`** (75,382 to 75,417; P12's +42 less 7): the
package does **not** reach net <= 0, so the `pnpm sizes` ratchet fails and `pnpm check` is red on
`sizes` only. Needs the owner (approve +35) or more deletions from another package.

- **P14.1 land cycles (-7 vs the P12 tip).** Recognizer `land-cycles` fills `landCycles` (15 cycles;
  `basic` stays a type-line test in SQL). `CardText` now carries Scryfall's `keywords` (for `cycleland`).
  Migration `0051_land_cycles.sql`: `card_features.land_cycles text[]` plus a GIN index; `is:shockland`
  and the others are `land_cycles @>` on `card_features`. Deleted `landCycle`, `landSaying` and their
  constants in `sql.ts` (the audit's "matchers in decks/domain/{mana-base,stats,rules}" do not exist:
  the cycles were Postgres regexes). Also: the `blitz` scope reads Scryfall's keyword list (deck lines
  already carry `keywords`), so `CastabilityLine.text` and a regex went. `deck-profile.ts` left
  `NOT_YET_RECOGNIZED`.
- **P14.2 tokens (0).** No token-making recognizer: doc 66 question 7 keeps Scryfall's links for what to
  print, and `token-choices.ts` has no text copy. `tokenKind` reads type-line words with `hasTypeWord`
  instead of two regexes; `token-proxies.ts` left the list.
- **P14.3 draft abilities (0).** `DRAFT_ABILITIES` already existed; `timers.ts` now asks it (extraCard
  with `then: "intoPack"`) instead of comparing the name "Cogwork Librarian". `creatureTypes` lost its regex.
- **P14.4 lint (0 production lines).** `cards/card-name-literal` (`eslint-rules/card-name-literal.mjs`):
  no `name === "<literal>"` in catalog, decks and drafts `domain/`.
- **`FEATURES_VERSION` 3** (2 -> 3: `landCycles`, `CardText.keywords`). Run migration 0051, then
  `pnpm worker sync features`; until then `is:shockland` and friends find nothing.
- **Regex baseline 124 -> 120.** Production lines 75,424 (P12 tip) -> 75,417.
- **A2:** the 15 land-cycle expectations of `search-language.int.test.ts` pass unchanged (old SQL
  answers) and 19 fixture cards are in the recognizer's table. Not run over the 33,479 dev cards.
  Differences to decide: (1) `blitz` now needs the keyword, so a card that only mentions "blitz" in
  its text (granting it) no longer counts; (2) `pathway` is `Land // Land` type line without the
  `modal_dfc` layout check; (3) `tokenKind` is case-sensitive (Scryfall always capitalizes).
- **Integration files run** (against a private DB `tcg_p14_test`; the shared `tcg_test` was already
  migrated by P13): search-language, mana-base, card-features, draft-deck, drafts, token-proxies,
  decks, card-search: all green.
