# decks: scoring (rating, suggestions, cuts, swaps, replacements, optimizer)

How the app judges cards for a deck: one rating function, and the lists built on it. Code:
`src/modules/decks/scoring/` (rate, signals, suggest, cuts, swaps, replacements, optimize) and the
EDHREC and embedding data it reads. Checked against `refactor/main` (2026-11-20) by the tests named
in brackets. Owner decisions that shape this page: one scorer (D1, P27), weights fitted from data
(D5), advice split into scoring and building (D4), and **tools show no scores or ranks**: the output
is ideas to consider, never recommendations (owner answers, 2026-11-19).

## The one scorer

1. **`rateCard` is the only scorer.** Suggestions for a deck, suggestions for a role, "cards like
   this one", budget picks, cuts, the swap panel's candidates, draft-a-deck and the optimizer all
   order cards by it. They differ in their **inputs** (a cut asks about the card inside the deck;
   a role list treats the role as the only gap), never in the weight table. (doc 46 §3-4, doc 47-rating
   §3; P27 handoff; `rate.test.ts`)
2. **The weights are fitted from data**, not tuned by hand: `RATING_WEIGHTS` plus per-tier overrides,
   produced by `scripts/dev/fit-rating-weights.ts` from Commander precon lists, with only the two
   caps and two penalties set by hand. If a result looks wrong, refit; do not edit one number.
   (doc 57 §3 rule 1, doc 58 §7.1; owner D5; `rate.ts` header)
3. **A rating is an integer in [0, 100]**, `sigmoid(0)` is 50, and the logit equals the bias plus the
   sum of its parts; every non-zero part has a human-readable label. Rating is pure and
   deterministic. (doc 46 §4 rules 1-3 and 6; `rate.test.ts`)
4. **Three power tiers**, chosen from the deck's target bracket: casual (1-2), upgraded (3 or none),
   optimized (4-5); theme counts more in casual, quality more in optimized. (doc 47-rating §8.1;
   `powerTierForBracket`, `rate.test.ts`)
5. **A commander's `makes`/`uses` signals count 3 times a main-deck card's**, and deck signal counts
   are dampened with a square root. (doc 46 §4 rule 4; `signals.test.ts`)
6. **EDHREC adds symmetric log-lift plus inclusion.** A card with inclusion of 25% or more and
   neutral synergy is never penalised (staple protection); a strongly negative synergy with a large
   enough sample is. A commander with no EDHREC data (or a non-Commander deck) behaves as if the
   signal did not exist. (doc 58 §4 rule 3 and §7.1, doc 45 §4 rule 3; `rate.test.ts`)
7. **Curve penalties** apply to an expensive card in a top-heavy deck and to a card whose mana-value
   slot is full (the 7+ slot takes every bigger card). (doc 46 §3; `rate.test.ts`)

## Suggestions (additions)

8. **A suggestion is never already in the deck, never a basic land, always within the commander's
   colour identity** (other formats: the deck's colours when it has any) **and legal in the format**
   (casual: anything). It is never made for strength alone: at least one reason names why it fits
   the deck. (doc 20 §4 rules 2 and 6, §13.3; `suggest.test.ts`)
9. **Owned before store at equal score.** A store card is one for sale: an enabled set and a known
   price, at its cheapest printing and finish. A card owned in any printing is only in the owned
   pool. (doc 20 §4 rules 3-4; `suggest.test.ts`, `suggest-cards.test.ts`)
10. **Suggestions are additions.** Nothing here suggests a cut; cuts are a separate list. Roles are
    only checked where the format has role targets. (doc 20 §13.2, doc 19 §13.2)
11. **Budget picks** take the best value first (score per dollar, any card under $1 counts as $1),
    skip what no longer fits, take one copy of each, never repeat a card, never go over the budget
    and take at most 15 cards; only store cards are picked. (doc 20 §4 rule 5 and §13.4;
    `suggest.test.ts`, `BUDGET_LIST_MAXIMUM`)
12. **Avoid cards are never offered:** replacement and deck-search results leave out a card the
    player marked "avoid". (Doc 61 §4 rule 4 also says nothing suggests cutting a key card; only the
    tool instructions state that, no test does, so it is not listed as a rule.) (doc 61 §4 rule 4;
    `find-replacements.test.ts`, `deck-search.test.ts`)
13. **Bracket respect:** with a target bracket, no suggestion, swap or replacement raises the floor
    above it; Game Changers are never recommended in brackets 1-2; combo partners are boosted in 3
    and up and ignored in 2. (doc 31 §4 rule 10, doc 46 §4 rule 5, doc 52; `suggest.test.ts`,
    `swaps.test.ts`)

## Cuts, swaps and replacements

14. **Cuts** never list a land, a commander, or a sideboard or maybeboard card; equal scores order by
    name, then card id; a card that is not owned counts against it; a Game Changer over the target
    bracket is cut first; a high-synergy or high-inclusion EDHREC card gets a keep bonus so
    suggestions and cuts agree. (doc 32 §4 rules 4-5, doc 45 §11.3; `cuts.test.ts`)
15. **Swaps** pair the weakest cuts with the best replacements. A swap never cuts a basic land,
    never adds a card already in a singleton deck, never adds a Game Changer in brackets 1-2, and
    is returned only if it improves the deck or fixes an over-bracket or not-owned problem. Order:
    net gain, then added rating, then the cut's keep order, then card id. Role-preserving and
    similar-effect replacements are preferred. (doc 47-rating §4 rules 2-4, doc 54 §4;
    `swaps.test.ts`)
16. **Budget replacements** are actually cheaper than the card they replace (and under any maximum
    price given), respect legality, colour identity, copy limits and the target bracket, share a role
    with the target, and are ordered by a blend of similarity to the card and fit to the deck, ties
    broken deterministically. Cards without a price are left out. (doc 53 §5, doc 61 §4 rule 5;
    `replacements.test.ts`)
17. **The optimizer** (`optimizeDeck`) is deterministic for a given seed and an injected `Rng`;
    never cuts commanders, lands or locked cards; keeps Commander singleton; returns at most
    `maxSwaps`; respects a maximum added price; and **never changes the saved deck**: changes apply
    only when the player or model applies them. Its objective (`scoreDeck`) is the rating per card
    plus deck-level terms (roles, curve, colour balance, cohesion, bracket and budget).
    (doc 55 §4; `optimize.test.ts`)
18. **The reference decks order the same way every run:** a tuned deck scores above a precon, and a precon above an unfocused deck. (doc 55; `reference-decks.test.ts`)
19. **Semantic search (embeddings)** is data, not a rule: card text embeddings are computed by the
    worker, only for cards missing or stale (`embed-cards` is incremental and idempotent), and the
    domain stays pure. (doc 53 §5 rules 1 and 4; `embed.test.ts` in `catalog`)

## What tools show

20. **No scores, ratings, ranks or ids in tool output.** `find_replacements`, `search_cards` and
    `get_deck` return cards and at most three short reasons; descriptions say "ideas to consider,
    not recommendations"; output is kept small in tokens. (owner D1, 2026-11-19; P27 handoff;
    `replacements.test.ts` in `_llm-tools/present`)

## Open decisions (found while writing this page)

- Doc 47-rating §8.1 and doc 57 propose weights "calibrated per tier" with an `upgrade_roadmap`
  tool; doc 57 also describes a `diff_deck` and doc 56 an `audit_deck` tool. None is among the 16
  current tools (see `llm-tools.md`). Whether they return is a decision, not assumed here.
- Doc 20 decision 1 stores features per printing with `CARD_FEATURES_VERSION`; doc 66 and ADR 0027
  store them per card. The code follows ADR 0027 (see `card-features.md`).
