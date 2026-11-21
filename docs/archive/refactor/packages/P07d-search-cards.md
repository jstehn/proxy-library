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

**Done:** `search_cards` is a binding (`bindings/search-cards.ts`, `present/search-cards.ts`) over
five small capabilities, one per branch of the old tool:

- `searchCatalog` (`catalog/application/search-catalog.ts`): your game and real collection, or the
  store, without a deck. Fake-reader tests.
- `deckSearch.searchForDeck` and `deckSearch.semantic` (`decks/application/deck-search.ts`): the
  synergy search and the search by meaning, both leaving out the deck's avoid cards. Fake-reader
  tests. The search results pass through generically, so the application layer names none of the
  query types.
- `deckSignals` (from P06) and the new `searchSignals` (`decks/application/deck-signals.ts`) for
  mode "signals".
- `textEmbedder` is now a dependency of `buildCapabilities` (semantic search).
- Deleted: the old `search_cards`, `search_for_deck`, `analyze_cards` and
  `semantic_search_for_deck` tools; `tools/search.ts` is gone.
- **Checked:** the binding and the old tool gave identical JSON for 21 inputs across all four
  modes (store, owned, game and real searches with text and price options, paging, a deck with
  one query and several, `where`, a price cap, signals for a deck and for a search, a missing
  deck, and the invalid-input cases). The valid path of semantic search was **not** compared: it
  needs the embedding service (network), which tests don't use.

**Notes:**

- `docs/refactor/reference/tools/search_cards.json` now regenerates with `targetBracket: null`
  where it had 2. That is the script's order, not behaviour: it runs each tool in registry order,
  bindings first, so `search_cards` now runs before `update_deck` sets the bracket. Left as is.
- Not changed: the builder's `browseAction` and `cardDetailAction`. `browseAction` reads
  `browseCollection` (a deck-builder grid query, not this search) and `cardDetailAction` is one
  `printingCards` lookup; both stay on the builder's own queries until P18 (`browseCollection`
  also belongs with the candidate pool work).
