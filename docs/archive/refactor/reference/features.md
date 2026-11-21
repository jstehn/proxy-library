# Feature inventory (pre-refactor)

A checklist of what the app does today, one line per page, server-action file and LLM tool.
Milestones tick these off once the rebuilt version works again (docs/refactor/STATUS.md).
Final pass 2026-11-21: 61 rows matched to a test that drives them; the other 17 checked by eye on the
e2e database in dark mode at 390px; the last row got its tests the same day.
Reference outputs of the LLM tools are in `tools/*.json` (`draw_sample` shuffles, so its card order
differs between runs; the four tools that call outside services record only their input schema).

## Pages (`src/app/**/page.tsx`)

- [x] `/` home: dashboard and links
- [x] `/account`: account overview and starting over
- [x] `/account/password`: change password
- [x] `/account/profile`: display name and profile
- [x] `/account/tokens`: create and revoke LLM access tokens
- [x] `/activity`: feed of friends' and own events
- [x] `/admin`: admin home
- [x] `/admin/catalog`: catalog sync, enable sets
- [x] `/admin/economy`: allowance and economy settings
- [x] `/admin/invites`: create and revoke invites
- [x] `/admin/packs`: booster recipe checks
- [x] `/admin/photos`: choose set/page photos
- [x] `/admin/photos/[code]`: choose a set's photo
- [x] `/admin/players`: manage players, money, reset
- [x] `/admin/store`: store pricing mode, prices, buylist rate
- [x] `/register`: sign up with an invite
- [x] `/sign-in`: sign in
- [x] `/cards/[id]`: card page, buy and sell singles
- [x] `/collection`: your collection
- [x] `/collection/real`: real (physical) collection
- [x] `/collection/real/import`: import a real collection
- [x] `/decks`: your decks
- [x] `/decks/commanders`: commander picker, start a deck
- [x] `/decks/[id]`: deck page and builder
- [x] `/decks/[id]/export`: export a deck list
- [x] `/decks/[id]/print`: print proxies, token art
- [x] `/decks/shared`: decks shared with you
- [x] `/decks/to-get`: cards still to get for your decks
- [x] `/d/[token]`: public deck link
- [x] `/d/[token]/scorecard`: public deck scorecard
- [x] `/drafts`: drafts list, create and join
- [x] `/drafts/[id]`: a draft: picking, bots, deals, deck
- [x] `/friends`: friend requests and friends
- [x] `/inventory`: sealed product, open packs
- [x] `/inventory/opened`: opened-pack history
- [x] `/oauth/authorize`: approve an OAuth client
- [x] `/players/[id]`: another player's profile
- [x] `/players/[id]/real`: their shared real collection
- [x] `/players/[id]/wishlist`: their shared wishlist
- [x] `/search-help`: card search syntax help
- [x] `/sets`: sets list
- [x] `/sets/[code]`: one set's cards
- [x] `/singles`: singles store search
- [x] `/singles/list`: quote and buy a pasted list
- [x] `/store`: sealed product store
- [x] `/store/[code]`: a set's products
- [x] `/trades`: trades list
- [x] `/trades/new`: propose a trade
- [x] `/trades/[id]`: a trade, accept or decline
- [x] `/wallet`: balance and ledger, add funds
- [x] `/wishlist`: your wishlist

## Server actions (`src/app/**/*actions.ts`)

- [x] `account/actions`: startOver
- [x] `account/password`: changePassword
- [x] `account/profile`: saveProfile
- [x] `account/tokens`: createToken, revokeToken
- [x] `actions`: signOut
- [x] `admin/catalog`: requestSync, enableStandardSets, setSetEnabled
- [x] `admin/economy`: updateEconomy
- [x] `admin/invites`: createInvite, revokeInvite
- [x] `admin/photos`: choosePhoto, setPageSlug (their use cases tested in `catalog.int.test.ts`, 2026-11-21)
- [x] `admin/players`: player actions, money actions, resetLibrary
- [x] `admin/store`: setKindPrice, setProductPrice, setPricingMode, setBuylistRate
- [x] `(auth)/register`: register
- [x] `(auth)/sign-in`: signIn
- [x] `cards/[id]`: buySingle, sellSingle
- [x] `collection/real`: sharing, clear, set copies, change printing, products, import preview and apply
- [x] `decks/actions`: create, update, uses-real-cards, delete, import/replace/preview list, visibility, public link (enable, rotate, revoke), copy deck, copy public deck, comments
- [x] `decks/commanders`: commanderCards, startDeck
- [x] `decks/[id]/builder`: browse, card detail, load deck, quantity, move, swap, other decks, take from deck, printings, suggestions, optimize, mana base, draft deck, add lands, similar, budget, target bracket, heading, note, snapshots (list, save, compare, restore, delete), tokens, entry details, deck plan
- [x] `decks/[id]/print`: tokenArts, chooseToken
- [x] `drafts/actions`: create, join, leave, start, pick, decide, choose colour, sneak, informant, deal, end deals, pick for away, make deck, add and remove bots
- [x] `friends`: send, accept, decline, cancel, unfriend
- [x] `inventory`: open
- [x] `oauth/authorize`: decide
- [x] `singles/list`: quoteList, buyList
- [x] `store`: buySealed
- [x] `trades`: proposeTrade, decideTrade
- [x] `wallet`: addFunds
- [x] `wishlist`: add, update, remove, sharing, buy, wish for short cards

## LLM tools (`src/app/_llm-tools/registry.ts`, served at `/api/mcp` and `/api/tools/<name>`)

_Ticked after P09: [x] matches the reference output or the old tool; [~] is a network tool checked only with fakes (see deferred-checks.md)._

- [x] `get_account`: balance, scopes, counts
- [x] `list_decks`: your decks
- [x] `get_deck`: a deck compactly or in full (signals, prices, primer, bracket)
- [x] `create_deck`: new deck, optionally from a list
- [x] `update_deck`: profile, plan, key cards, avoid cards, primer, target bracket
- [x] `edit_deck`: preview and save card changes or a whole list (fingerprint-checked)
- [x] `search_cards`: card search with synergy queries and deck context
- [x] `get_cards`: card details by name
- [~] `edhrec_lookup`: EDHREC recommendations (network)
- [~] `find_combos`: Commander Spellbook combos (network)
- [x] `find_replacements`: similar and budget replacements
- [x] `draw_sample`: sample hands and castability simulation
- [x] `rules_lookup`: rulings and Comprehensive Rules
- [~] `youtube_research`: deck-tech videos (network)
- [~] `reddit_research`: Reddit threads (network)
- [x] `manage_wishlist`: list, add, remove wishes
