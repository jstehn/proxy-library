# Feature inventory (pre-refactor)

A checklist of what the app does today, one line per page, server-action file and LLM tool.
Milestones tick these off once the rebuilt version works again (docs/refactor/STATUS.md).
Reference outputs of the LLM tools are in `tools/*.json` (`draw_sample` shuffles, so its card order
differs between runs; the four tools that call outside services record only their input schema).

## Pages (`src/app/**/page.tsx`)

- [ ] `/` home: dashboard and links
- [ ] `/account`: account overview and starting over
- [ ] `/account/password`: change password
- [ ] `/account/profile`: display name and profile
- [ ] `/account/tokens`: create and revoke LLM access tokens
- [ ] `/activity`: feed of friends' and own events
- [ ] `/admin`: admin home
- [ ] `/admin/catalog`: catalog sync, enable sets
- [ ] `/admin/economy`: allowance and economy settings
- [ ] `/admin/invites`: create and revoke invites
- [ ] `/admin/packs`: booster recipe checks
- [ ] `/admin/photos`: choose set/page photos
- [ ] `/admin/photos/[code]`: choose a set's photo
- [ ] `/admin/players`: manage players, money, reset
- [ ] `/admin/store`: store pricing mode, prices, buylist rate
- [ ] `/register`: sign up with an invite
- [ ] `/sign-in`: sign in
- [ ] `/cards/[id]`: card page, buy and sell singles
- [ ] `/collection`: your collection
- [ ] `/collection/real`: real (physical) collection
- [ ] `/collection/real/import`: import a real collection
- [ ] `/decks`: your decks
- [ ] `/decks/commanders`: commander picker, start a deck
- [ ] `/decks/[id]`: deck page and builder
- [ ] `/decks/[id]/export`: export a deck list
- [ ] `/decks/[id]/print`: print proxies, token art
- [ ] `/decks/shared`: decks shared with you
- [ ] `/decks/to-get`: cards still to get for your decks
- [ ] `/d/[token]`: public deck link
- [ ] `/d/[token]/scorecard`: public deck scorecard
- [ ] `/drafts`: drafts list, create and join
- [ ] `/drafts/[id]`: a draft: picking, bots, deals, deck
- [ ] `/friends`: friend requests and friends
- [ ] `/inventory`: sealed product, open packs
- [ ] `/inventory/opened`: opened-pack history
- [ ] `/oauth/authorize`: approve an OAuth client
- [ ] `/players/[id]`: another player's profile
- [ ] `/players/[id]/real`: their shared real collection
- [ ] `/players/[id]/wishlist`: their shared wishlist
- [ ] `/search-help`: card search syntax help
- [ ] `/sets`: sets list
- [ ] `/sets/[code]`: one set's cards
- [ ] `/singles`: singles store search
- [ ] `/singles/list`: quote and buy a pasted list
- [ ] `/store`: sealed product store
- [ ] `/store/[code]`: a set's products
- [ ] `/trades`: trades list
- [ ] `/trades/new`: propose a trade
- [ ] `/trades/[id]`: a trade, accept or decline
- [ ] `/wallet`: balance and ledger, add funds
- [ ] `/wishlist`: your wishlist

## Server actions (`src/app/**/*actions.ts`)

- [ ] `account/actions`: startOver
- [ ] `account/password`: changePassword
- [ ] `account/profile`: saveProfile
- [ ] `account/tokens`: createToken, revokeToken
- [ ] `actions`: signOut
- [ ] `admin/catalog`: requestSync, enableStandardSets, setSetEnabled
- [ ] `admin/economy`: updateEconomy
- [ ] `admin/invites`: createInvite, revokeInvite
- [ ] `admin/photos`: choosePhoto, setPageSlug
- [ ] `admin/players`: player actions, money actions, resetLibrary
- [ ] `admin/store`: setKindPrice, setProductPrice, setPricingMode, setBuylistRate
- [ ] `(auth)/register`: register
- [ ] `(auth)/sign-in`: signIn
- [ ] `cards/[id]`: buySingle, sellSingle
- [ ] `collection/real`: sharing, clear, set copies, change printing, products, import preview and apply
- [ ] `decks/actions`: create, update, uses-real-cards, delete, import/replace/preview list, visibility, public link (enable, rotate, revoke), copy deck, copy public deck, comments
- [ ] `decks/commanders`: commanderCards, startDeck
- [ ] `decks/[id]/builder`: browse, card detail, load deck, quantity, move, swap, other decks, take from deck, printings, suggestions, optimize, mana base, draft deck, add lands, similar, budget, target bracket, heading, note, snapshots (list, save, compare, restore, delete), tokens, entry details, deck plan
- [ ] `decks/[id]/print`: tokenArts, chooseToken
- [ ] `drafts/actions`: create, join, leave, start, pick, decide, choose colour, sneak, informant, deal, end deals, pick for away, make deck, add and remove bots
- [ ] `friends`: send, accept, decline, cancel, unfriend
- [ ] `inventory`: open
- [ ] `oauth/authorize`: decide
- [ ] `singles/list`: quoteList, buyList
- [ ] `store`: buySealed
- [ ] `trades`: proposeTrade, decideTrade
- [ ] `wallet`: addFunds
- [ ] `wishlist`: add, update, remove, sharing, buy, wish for short cards

## LLM tools (`src/app/_llm-tools/registry.ts`, served at `/api/mcp` and `/api/tools/<name>`)

- [ ] `get_account`: balance, scopes, counts
- [ ] `list_decks`: your decks
- [ ] `get_deck`: a deck compactly or in full (signals, prices, primer, bracket)
- [ ] `create_deck`: new deck, optionally from a list
- [ ] `update_deck`: profile, plan, key cards, avoid cards, primer, target bracket
- [ ] `edit_deck`: preview and save card changes or a whole list (fingerprint-checked)
- [ ] `search_cards`: card search with synergy queries and deck context
- [ ] `get_cards`: card details by name
- [ ] `edhrec_lookup`: EDHREC recommendations (network)
- [ ] `find_combos`: Commander Spellbook combos (network)
- [ ] `find_replacements`: similar and budget replacements
- [ ] `draw_sample`: sample hands and castability simulation
- [ ] `rules_lookup`: rulings and Comprehensive Rules
- [ ] `youtube_research`: deck-tech videos (network)
- [ ] `reddit_research`: Reddit threads (network)
- [ ] `manage_wishlist`: list, add, remove wishes
