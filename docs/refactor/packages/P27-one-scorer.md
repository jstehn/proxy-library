# P27. One scorer, and no scores or ranks in the MCP tools

- **Branch:** `refactor/P27-one-scorer` · **Depends on:** P13, P14, P24, P26 (it edits `rate.ts` and `suggest.ts`, which P13 changes; it doesn't need P15) · **Parallel with:** P15
- **Source:** [plan review](../reviews/plan-review/README.md) (P27; owner answers D1, D5), report [4](../reviews/plan-review/4-domain-engines.md)
- **Lines:** −300 to −500.
- **Big feature:** it changes behaviour. Needs a short design note (below) approved before code.

## Why

Three weight tables score cards: `RATING_WEIGHTS` (`rate.ts`), `WEIGHTS` (`suggest.ts`) and
`CUT_WEIGHTS` (`cuts.ts`). There are two `toRatingProfile` functions (`suggest.ts` line 322 and
`optimize.ts` line 116), two role-gap types, and `optimize.scoreDeck`. The owner answered **D1: one
scorer, if it's simpler** (`rateCard`), and **D5: the weights were fitted from data**. The owner
also said the MCP tools must **not show scores or ranks**: that makes heuristics sound
authoritative, and the tools are idea generators whose picks are often bad. Output should use few
tokens.

## Deletes

| What                                                                                                                                                                                       | Where                                                                                                                                 | Lines        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `WEIGHTS` and its use in `deckFit` / `scoreForDeck` / `scoreForRole` / `scoreLike`                                                                                                         | `src/modules/decks/domain/suggest.ts` (463 lines; lines 94–120 and 268–420)                                                           | −120 to −200 |
| `CUT_WEIGHTS`, `CUT_WEIGHTS_BY_TIER` and the cut-specific scoring                                                                                                                          | `src/modules/decks/domain/cuts.ts` (lines 81–127 and the code that uses them)                                                         | −60 to −120  |
| The second `toRatingProfile` and the duplicate role-gap type                                                                                                                               | `decks/domain/optimize.ts` (line 116) or `suggest.ts` (line 322): keep one                                                            | −30 to −60   |
| `optimize.scoreDeck` if `rateCard` per card plus one deck-level term covers it                                                                                                             | `decks/domain/optimize.ts` (line 220; `optimizeDeck` is 150+ lines)                                                                   | −40 to −100  |
| About 32 unexplained decimals in `rate.ts`: collapsed into one named, documented table                                                                                                     | `decks/domain/rate.ts` (`RATING_WEIGHTS` at line 103)                                                                                 | −10 to −30   |
| Score and rating fields in the tool answers: `rating` in `replacements.ts` (lines 20 and 50) and `search-cards.ts` (line 31), `heuristicScore` in `get-deck.ts` (line 54), and their types | `src/app/_llm-tools/present/{replacements,search-cards,get-deck}.ts`, the binding input and output schemas, `tests`, the OpenAPI text | −40 to −80   |
| `rank()` and `Scored` wrappers where nothing needs an order any more                                                                                                                       | `suggest.ts` (line 420) and callers in `queries/suggestions.ts` (lines 150 and 387), `commanders.ts` (line 369)                       | −20 to −50   |

(Some of these may overlap; count once. The real number goes in the handoff.)

## Touches

`src/modules/decks/domain/{rate,suggest,cuts,optimize,swaps,commanders,draft-deck}.ts`,
`src/modules/decks/queries/{suggestions,optimize,commanders}.ts`,
`src/app/_llm-tools/{present,bindings}/*`, `src/app/_llm-tools/cookbook.ts`, the builder panels
that show suggestions (check `grep -rn "rating\|score" src/app/decks`). **Avoid** the mana and
opening-hand engines (P15, P28).

## Steps

1. **Design note** (a section in `docs/design/` or an ADR addendum, short):
   - Which callers use which score today (suggestions, cuts, draft-a-deck, optimizer, commanders).
   - What `rateCard` gives each: where it needs a different **input** (a cut asks "how much does
     this card help the deck?") but not a different **weight table**. Different inputs are fine.
   - The one weight table, marked **fitted from data**, naming `scripts/dev/fit-rating-weights.ts`
     (P24 renames it) and the date and data it was fitted on.
   - The deliberate behaviour changes: a suggestion list and a cut list may reorder. Record
     before/after for the reference decks (`docs/refactor/reference/`, the P00 script
     `scripts/dev/reference-outputs.ts`) so the owner can look.
2. **Pin today's behaviour** for the reference decks: top 10 suggestions, top 10 cuts, the
   draft-a-deck pick list. Save as test fixtures. After the change, these are allowed to differ,
   but each difference is listed in the handoff.
3. **Move suggestions onto `rateCard`**, delete `WEIGHTS` and the `deckFit` / `scoreForDeck`
   branches it replaced, in the same commit. Then cuts (delete `CUT_WEIGHTS`), then the optimizer
   and `draftDeck` (delete the second `toRatingProfile`, `scoreDeck` if covered). One commit each,
   each net ≤ 0.
4. **One weight table.** In `rate.ts`, name each weight (full words), explain it in one line, and
   put the "fitted from data" note and the script name above the table. Remove weights that are
   always zero.
5. **The tools show no scores or ranks.**
   - Remove `rating`, `heuristicScore`, `score`, `rank`, `points` and the like from the tool
     answers and schemas. Order by the scorer, but don't show the number. Wording: list the cards
     as "ideas to consider", never "best" or "top" (see the owner's rule on recommendations).
   - Keep the reason labels (such as "fits Elves") only if short; drop long `fitLabels` arrays
     from tool answers.
   - **Compact output.** Remove fields the model doesn't need (repeated names, full oracle text
     unless asked, null fields). Measure: for `find_replacements`, `search_cards` and `get_deck`,
     record the response size in characters for three reference calls before and after, in the
     handoff. It must go down.
   - Update the tool descriptions and `cookbook.ts`, and the tests in
     `src/app/_llm-tools/llm-tools.int.test.ts`, `bindings/bindings.test.ts`.
6. **The builder UI** may still show a heuristic label to the player (check
   `grep -rn "rating" src/app/decks`). The owner's rule is about the **MCP tools**. Leave the UI
   unless it shows a bare number; if it does, tell the PM rather than changing it.
7. Run `pnpm check`, `pnpm test:int`, the e2e spec for suggestions
   (`pnpm test:e2e tests/e2e/accounts.spec.ts -g suggestions`). `pnpm sizes --update`.

## What not to do

- Don't tune weights by hand. If a result looks wrong, list it for the owner.
- Don't add a "compat" scorer beside `rateCard`.
- Don't remove the fitting function (`fitLogisticWeights`) or its script. They are how the
  weights are made.
- Don't call any tool output "best" or "weakest".

## Done when

- `grep -rn "CUT_WEIGHTS\|const WEIGHTS" src | grep -v test` finds nothing. There is one
  `RATING_WEIGHTS` table, with its fitting note.
- `grep -rn "toRatingProfile" src | grep -v test` finds one definition.
- `grep -rniE "rating|score|rank" src/app/_llm-tools/present src/app/_llm-tools/bindings | grep -v test`
  finds no field that reaches the tool output (check the schemas by eye and in the tool tests).
- The response sizes before and after are in the handoff, and the sizes go down.
- `pnpm check`, `pnpm test:int` and the suggestions e2e spec are green. The sizes baseline is
  lowered.

## Needs the owner

- Look at the before/after lists for the reference decks (step 1's note). This package changes what
  the suggestions say.

## Handoff

**Branch** `refactor/P27-one-scorer`. Commits: the before lists; "suggestions, roles, similar cards,
cuts and draft-a-deck all use rateCard" (-335 production lines); "the MCP tools show no scores,
ratings or ranks" (-1); the after lists, baselines and this handoff.

**Lines:** production code 75,422 to 75,086 (-336). The size and knip (383 to 382) baselines are
lowered; the clone and regex baselines didn't move.

**The one scorer.** `rateCard` (`rate.ts`) now orders suggestions for the deck, per role, "cards
like this one", budget picks, cuts, the swap panel's candidates, draft-a-deck and the optimizer.
One table, `RATING_WEIGHTS` plus the two tier overrides, one line per weight, marked fitted from
data (`scripts/dev/fit-rating-weights.ts`, last fitted 2026-11-13; only the two caps and the two
penalties are set by hand). A cut, a role list and "like this one" differ in their **inputs** (the
deck's profile with this card's role as the only gap, a deck made of one card, an `overBracket`
flag), never in the weight table.

**Deleted:** `WEIGHTS`, `deckFit`'s points, `edhrecFit`'s points, `scoreForRole`'s and
`scoreLike`'s own sums, `Scored.score` and the score fallbacks in `queries/suggestions.ts`;
`CUT_WEIGHTS`, `CUT_WEIGHTS_BY_TIER`, `CutWeights` and `RankedCut.keepScore`; **all three**
`toRatingProfile` copies (suggest, optimize, and an inline copy in `cuts-panel.tsx`): `DeckFingerprint`
is now the `RatingProfile`, so no conversion is needed (the grep finds none, not one); `RoleGap`
(now `RoleGap` in `rate.ts` only), `RatingEdhrecSignal`, `CandidateCard`'s copy of
`RatingCandidate`, the duplicate `strength` and `RARITY_STRENGTH` (`strength` moved into `rate.ts`
and the quality prior's fallback uses it); `penalizeGameChanger` (never passed outside tests; now
`overBracket` on the candidate); the two hand-copied `rateCard` inputs in `optimize.ts`.
**Kept, because:** `optimize.scoreDeck` already is `rateCard` per card plus the deck-level terms
(roles, curve, colors, cohesion, bracket, budget); the audit, scorecard and snapshots use those
terms, so it stays. `rank()` and `Scored` stay: they order by `rating.logit`.

**Tools.** `find_replacements`, `search_cards` (semantic) and `get_deck` (facts) no longer carry
`rating`, `ratingParts`, `similarityPct`, `heuristicScore`, ids (`oracleId`, `printingId`) or a zero
`hiddenOverTarget`; `why` is three reasons at most, and the text-similarity percentage reads
"Reads like the deck". Descriptions and the cookbook say "ideas to consider, not recommendations".
Response sizes (characters of JSON, fixture catalog, no embeddings):

| call                                                 | before | after   |
| ---------------------------------------------------- | ------ | ------- |
| find_replacements `{card, deckId}`                   | 1120   | 574     |
| find_replacements `{card, deckId, includeText, 20}`  | 2302   | 1756    |
| find_replacements `{deckId}` (budget, nothing found) | 62     | 62      |
| search_cards syntax `{deckId, search}`               | 552    | 553 \*  |
| search_cards semantic `{deckId, query}` (no results) | 94     | 73      |
| search_cards signals                                 | 48     | 48      |
| get_deck `{deckId}`                                  | 1134   | 1135 \* |
| get_deck `{include: [facts, signals], text}`         | 7910   | 7603    |
| get_deck `{view: full, include: [facts]}`            | 5673   | 5366    |

\* the deck id is two digits wide in the second run; nothing else changed. A suggestion entry fell
from about 280 to about 135 characters. The fixture catalog is small: a real deck's list is longer.

**Before and after lists:** `docs/refactor/reviews/p27-before-after.md`. The lists in the first
commit used more random numbers; the final file replaces them with the same decks, hand-set EDHREC
numbers for well-known cards (so Grizzly Bears isn't "popular") and seeded numbers for the rest,
run on the old code in a separate checkout of `refactor/main`.

**Tests:** unit tests for the touched files, `suggest.test.ts`, `swaps.test.ts`, and the new
`present/replacements.test.ts` (no score, rating, rank or similarity in the answer). Integration
(private database `tcg_p27_test`, one file at a time): suggestions, draft-deck, commanders,
embeddings, decks, deck-previews, sharing and `llm-tools.int.test.ts`. Not run (told not to): e2e.

**Open questions for the owner**

1. **The builder's suggestions panel still shows a bare number** (`suggestions-panel.tsx`: a grey
   badge with the 0-100 rating, and a tooltip listing its parts). Left alone, as instructed. The
   cuts panel shows none.
2. **Cuts and role need.** The fitted weight for "the deck is short of this role" is small, so ramp
   spells can appear in the cut list while the deck is short of ramp (the "cutting it would leave a
   gap" reason still shows). Not tuned by hand. A fix, if wanted, is a re-fit with a cut-specific
   profile (count minus this card).
3. **`similarityPct` is gone from the tools too** (a score by another name); the ordering still
   uses it. Say if you want it back as words ("close", "loosely").
4. `rules-lookup` describes its excerpts as "Top-ranked". That is a search result, not a card
   rank; left as it was.
5. `get_deck`'s `facts` and `mana_plan` still carry percentages from simulations
   (`averageCastOnCurvePct`, `castOnCurvePct`). They are measurements, not scores; P15 and P28 own
   that code.
6. `toRatingProfile` is gone (zero definitions): "one definition" in Done when is met by there being
   no conversion at all.
