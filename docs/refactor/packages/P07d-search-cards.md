# P07d. search_cards as a binding

- **Branch:** `refactor/P07d-search-cards` · **Depends on:** P07c · **Parallel with:** P08
- **Audit:** doc 65 F6
- **Recipe:** [dedup playbook](../dedup-playbook.md) S1 (`search_cards` row); follow the P06 and P07c handoffs

## Goal

`search_cards` comes from a binding over capabilities. It is four searches behind one tool; each
becomes a capability, and the builder's `browseAction` and `cardDetailAction` use the same ones.

| Mode                    | Today (internal tool)                                                       | Capability       |
| ----------------------- | --------------------------------------------------------------------------- | ---------------- |
| `syntax`, no deck       | `searchCards` (`tools/search.ts`): collection, real collection or store     | `searchCatalog`  |
| `syntax`, with `deckId` | `searchForDeckTool` → `searchForDeck` query                                 | `searchForDeck`  |
| `semantic`              | `semanticSearchForDeckTool` (`tools/library.ts`)                            | `semanticSearch` |
| `signals`               | `analyzeCards` (deck signals exist as `deckSignals`; owned signals are new) | `ownedSignals`   |

## Touches

`src/app/_llm-tools/tools/{consolidated,search,library}.ts`, new `bindings/search-cards.ts` and
`present/search-cards.ts`, capabilities in `catalog`, `decks` (and collection/real-collection
through ports), `capabilities.ts`, the builder's `browseAction` and `cardDetailAction`.
**Avoid:** edit tools (P08).

## Steps

Same as P07c: for each mode a capability with ports and fake-reader tests; one binding with the
public tool's schema and description word for word; `present` in `_llm-tools/present/`; compare the
binding with the old tool over several inputs per mode (including empty and failing ones) before
deleting the old code; reference outputs unchanged.

## Done when

- `search_cards` is a binding; `search_for_deck`, `semantic_search_for_deck` and `analyze_cards`
  internal tools and their tests are gone.
- `browseAction` and `cardDetailAction` have no `db` access.

## Handoff

(empty)
