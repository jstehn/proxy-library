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

(empty)
