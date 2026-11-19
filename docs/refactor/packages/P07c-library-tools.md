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

**Done so far (2 of 4 tools):**

- `get_cards` is a binding (`bindings/get-cards.ts`, `present/get-cards.ts`) over two capabilities:
  `lookUpCards` (`catalog/application/card-lookup.ts`, readers for the card, price trend, copies,
  decks, wishes, store printings; `catalog/queries/store-printings.ts` is the one
  "store printings of a card" read) and `checkOwnedCards` (a thin forward in
  `capabilities.ts`: it has no logic to test; it becomes a real capability when P18 moves the
  query). The old `get_cards`, its internal `getCard` and `printingsFor` are deleted.
- `manage_wishlist` is a binding (`bindings/manage-wishlist.ts`, `present/wishlist.ts`) over
  `wishlistView`, `addWishes` and `removeWishes` (`wishlist/application/wishlist-tools.ts`, fake
  readers in `wishlist-tools.test.ts`). The old tool file `tools/wishlist.ts` and the dead
  `getAccountCompact` are deleted.
- **Checked:** for both, the new binding and the old tool gave identical JSON over every input
  tried (get_cards: compact, price, full, owned, owned with price, a missing card; manage_wishlist:
  list, empty add, empty remove, add with a missing card and two invalid finishes, then list and
  remove). Reference outputs unchanged. `pnpm check` and the 278 integration tests pass.

**Notes:** `registry.test.ts` now sorts the write tools (bindings are served first, so the
order changed). The comparison scripts were temporary and are deleted.

**Not done:** `find_replacements` (with the builder's similar and budget actions) and
`search_cards` (with `browseAction`, `cardDetailAction`). `search_cards` calls
`analyzeCards`, `semanticSearchForDeck`, `searchForDeck` and `searchCards`; `find_replacements`
calls `similarCards` and `budgetReplacements` (both in `queries/` until P18 moves them).
