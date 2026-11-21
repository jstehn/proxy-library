# What the app promises: one page per responsibility

These pages hold the product rules the code must keep, each with the design doc it came from and the
test or constant that holds it. They replace reading 60-odd design docs in order. The old design docs
are the record of **why** ([../design/README.md](../design/README.md) lists each with its status);
when a rule changes, change it here and in the code together.

Every rule was checked against the code on 2026-11-20 (`refactor/main`). Where the code and a doc, or
two docs, disagree, the page says so under its "Disagreements" or "Open decisions" heading and does not
pick a side silently.

| Page                                     | Responsibility (code)                                                                                    | Rules |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| [decks-core.md](decks-core.md)           | the deck: boards, formats, ownership, printings, text, headings, sharing, brackets (`decks/core`)        | 29    |
| [decks-scoring.md](decks-scoring.md)     | the one scorer, suggestions, cuts, swaps, replacements, optimizer (`decks/scoring`)                      | 20    |
| [decks-building.md](decks-building.md)   | browsing, mana base, commanders you can build, draft-a-deck, deck search (`decks/building`)              | 17    |
| [decks-play.md](decks-play.md)           | test hands, odds, the cast simulator (`decks/play`)                                                      | 13    |
| [decks-proxies.md](decks-proxies.md)     | proxy sheets, playtest cards, token proxies (`decks/proxies`)                                            | 13    |
| [llm-tools.md](llm-tools.md)             | the 16 MCP/OpenAPI tools, tokens, connector OAuth, outside research (`app/_llm-tools`, `accounts`)       | 21    |
| [card-features.md](card-features.md)     | what a card does: roles, themes, signals, flags (`catalog` features)                                     | 15    |
| [catalog.md](catalog.md)                 | cards, sets, prices, images and the outside data synced into them (`catalog`)                            | 17    |
| [economy.md](economy.md)                 | wallet, prices, store, packs, inventory, opening (`wallet`, `store`, `packs`, `inventory`, `ui/opening`) | 20    |
| [game-collection.md](game-collection.md) | cards owned in the game, trades, wishlist, reset, activity, exports                                      | 14    |
| [real-collection.md](real-collection.md) | cards owned for real, kept apart from the game's money                                                   | 9     |
| [drafts.md](drafts.md)                   | live booster drafts and Conspiracy drafts (`drafts`)                                                     | 14    |
| [accounts.md](accounts.md)               | accounts, invites, Authentik sign-in, profiles and friends (`accounts`, `social`)                        | 11    |
| [platform.md](platform.md)               | Docker start-up and the PWA                                                                              | 4     |

## Responsibilities without a page of their own

- **`decks/overview`** (deck facts, the deck overview, the optimizer read, snapshots comparison)
  only combines reads from the other areas; it has no product rules. Its shape is ADR 0029 and its
  access rules are in [../design/67-read-layer.md](../design/67-read-layer.md).
- **`reddit`, `youtube`** are outside research for the tools; their rules are in
  [llm-tools.md](llm-tools.md) rule 16.
- **`reset`, `activity`, `trades`, `wishlist`** are in [game-collection.md](game-collection.md); their
  code stays separate modules until P30 says otherwise.
- **The search language and the read layer** have ADRs ([0017](../adr/0017-shared-card-search.md),
  [0026](../adr/0026-capabilities-and-adapters.md)) and design docs 66 and 67 as their reference.

## Adding or changing a rule

A new design doc names the page it changes (TEMPLATE.md) and updates that page when it is built. A
rule that changes behaviour a player notices is a decision for the owner, not a refactor. Run
`pnpm docs:citations` after moving a doc.
