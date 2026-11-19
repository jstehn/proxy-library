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
   - The one weight table, marked **fitted from data**, naming `scripts/fit-rating-weights.ts`
     (P24 renames it) and the date and data it was fitted on.
   - The deliberate behaviour changes: a suggestion list and a cut list may reorder. Record
     before/after for the reference decks (`docs/refactor/reference/`, the P00 script
     `scripts/reference-outputs.ts`) so the owner can look.
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

(empty)
