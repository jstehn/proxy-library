# P07c. Card and wishlist tools as bindings

- **Branch:** `refactor/P07c-library-tools` · **Depends on:** P05, P07a (P07b for `search_cards` on the pool) · **Parallel with:** P08
- **Audit:** doc 65 F6, D11
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) (`search_cards`, `get_cards`, `find_replacements`, `manage_wishlist` rows) · **Lines to remove:** about −500 to −800

## Goal

The four tools come from bindings over capabilities, and the UI callers use the same capabilities:
`cardDetails` (catalog), `searchCards` and `searchForDeck`, `findReplacements`, the wishlist
capabilities. The wishlist reads today's offer through the store's quote (P07a's
`storeOfferRows`, then the store's `quote`).

## Touches

`src/app/_llm-tools/tools/{consolidated,search,library,wishlist}.ts`, new `bindings/` and
`present/` files, capabilities in `catalog`, `decks` and `wishlist` `application/`,
`src/app/decks/[id]/builder/actions.ts` (`browseAction`, `cardDetailAction`, `similarAction`,
`budgetAction`), `app/wishlist/actions.ts`. **Avoid:** edit tools (P08).

## Steps

Follow P06's pattern (see its handoff): capability with ports and fakes, binding with the public
tool's description and input schema word for word, `present` in `_llm-tools/present/`, then
compare old and new output over several inputs before deleting the old tool, and refresh the
reference outputs.

1. `get_cards`, then `manage_wishlist` (smallest).
2. `find_replacements` (`similarCards`, `budgetReplacements`) and the builder's similar and
   budget actions.
3. `search_cards` last; if P07b is not merged, call the existing search queries unchanged.

## Done when

- The four tools come from bindings; their old tool code and tests are deleted.
- The builder's browse, card-detail, similar and budget actions have no `db` access.

## Handoff

**Done (3 of 4 tools):**

- `get_cards`: binding over `lookUpCards` (`catalog/application/card-lookup.ts`, fake-reader tests)
  and `checkOwnedCards` (a thin forward in `capabilities.ts`: no logic to test; the query behind
  it moves in P18). New `catalog/queries/store-printings.ts` is the one "store printings of a
  card" read. Old tool and its internal `getCard` deleted.
- `manage_wishlist`: binding over `wishlistView`, `addWishes`, `removeWishes`
  (`wishlist/application/wishlist-tools.ts`, fake-reader tests). Old `tools/wishlist.ts` and the
  dead `getAccountCompact` deleted.
- `find_replacements`: binding over `replacements.similarTo` and `replacements.cheaperAlternatives`
  (`decks/application/find-replacements.ts`, fake-reader tests). Old tool, `similar_cards`,
  `idea_budget_replacements` and the dead `getAccount` in `tools/library.ts` deleted.
- To let `application/` name the types, `BrowseCard` and the suggestion types
  (`SuggestionCard`, `Suggestion`, `SuggestionList`, `SuggestionContext`, the budget replacement
  types) moved to `decks/domain/` (`browse-card.ts`, `suggestion-types.ts`), and
  `withoutAvoidCards` moved to `decks/domain/deck-profile.ts` (its test moved with it).
- **Checked:** for each tool the new binding and the old tool gave identical JSON over every
  input tried (get_cards 5, manage_wishlist 7, find_replacements 8 including a deck with an avoid
  card). Reference outputs unchanged. `pnpm check` and the 278 integration tests pass.

**Deviations:**

- `find_replacements` with a `card` but no `deckId` used to crash with a database error (it passed
  an undefined deck id to the query). It now answers `InvalidInput`: "give `deckId` with `card`".
  The description still says deckId is optional for the card form; a follow-up could make the
  query work without a deck.
- `find_replacements` accepts `where`, `limit` and (for the card form) `maxPriceCents` but, as
  before, ignores them. Kept as is so the public schema doesn't change; worth fixing or removing
  in P09.
- `registry.test.ts` sorts the write tools (bindings are served first, so the order changed).

**Not done: `search_cards`** (and the builder's `browseAction`, `cardDetailAction`, `similarAction`,
`budgetAction`). `search_cards` is four searches behind one tool (syntax search of the catalog and
collections, the synergy search for a deck, semantic search, and signals), each with its own
output shaping, built on `searchPrintings`, `collectionPage`, `realCollectionPage`,
`searchForDeck`, `semanticSearchForDeck` and `analyzeCards`. It should be its own package
(P07d), done after P18 moves the search queries, or sooner if wanted. The builder actions
`similarAction` and `budgetAction` can call `replacements.similarTo` / `cheaperAlternatives`
now; `browseAction` waits with the search work.
