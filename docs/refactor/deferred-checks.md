# Checks the refactor deferred

Things that **couldn't be verified inside a package** (they need the network, a browser, or a
person looking), so they wait here. Run them before each milestone merge into `main` (STATUS,
"Milestones"). When one is done, tick it and note the date and the commit. New ones go at the
bottom with the package that left them.

Why they wait: automated tests never touch the network (memory: tests stay offline), and the
refactor so far has been checked with `pnpm check`, the integration suite and one-off comparisons
of old and new tool output.

## Needs the network (`pnpm test:remote`, never run automatically)

- [ ] **`search_cards` mode `semantic` (P07d).** The old and new code were not compared on a valid
      search because it calls the embedding service. Add a remote test that runs a concept search
      for a deck and checks the answer has `concept`, `owned`, `store`, `hiddenOverTarget`, and
      leaves out an avoid-listed card.
- [x] **Run live 2026-11-19 (in-process, real network): `edhrec_lookup` (commander and deck), `find_combos`, `rules_lookup` rulings, `youtube_research` all answered. `reddit_research` returns its own "Reddit blocked anonymous access" error until `BRAVE_SEARCH_API_KEY` or `SEARXNG_URL` is set.** Original item: **Tools that call outside services were never exercised by the reference outputs:**
      `edhrec_lookup`, `find_combos` (Commander Spellbook), `rules_lookup` rulings,
      `youtube_research`, `reddit_research`. Check each still answers after P09 moves them.
- [ ] **Embedding-based `find_replacements` (budget path) and `similarCards` neighbours.** They
      read stored embeddings, not the network, but the fixture catalog has none: confirm with real
      data that the lists are not empty.

## Needs a browser (`pnpm test:e2e`, Playwright)

- [x] **Playwright suite (run 2026-11-19 after P09: 26 of 26 pass).** Seven stale test locators were fixed first (see commit); no app code changed. Original item: **The Playwright suite has not been run since P05.** Run it once now and after each wave:
      the deck builder (P06 changed how it loads), the deck page and shared view, wishlist pages.
- [x] **Looked at 2026-11-19 (dark theme, desktop 1400 wide and phone 375 wide, after P09): deck list, deck page, builder grid and stats, suggestions panel, test hand, plan and primer save, edit as text (preview and save), new deck, wishlist; no horizontal scroll, bottom nav and Menu button fine.** Not looked at: light mode, the Visual deck view, the mana base and draft panels, tablet width. Original item: **Look at it, dark mode and at phone width** (memory: user tests dark and mobile): the
      builder grid and the suggestions panel after P07b changed which printing an owned card shows.

- [x] **Done in the browser 2026-11-19: Edit as text, the plan and primer panel, and new deck (P08).** In the browser: save a
      deck's plan with key and avoid cards, edit a deck as text, make a new deck.
- [ ] **Stored previews survive a restart (P08).** Preview an `edit_deck` change, restart the app
      (`pnpm dev:all`), then save it with the `previewId` from an MCP client.

## Needs a person to judge

- [ ] **Which printing an owned card shows (P07b).** Suggestions, draft, mana base and commanders
      now show the "most special" copy where they showed the most-held one. Check a few real decks
      read right (foil and borderless copies you own).
- [ ] **Mana base store lands (P07b).** They are now ranked by colour, role and theme fit instead
      of an arbitrary 200. Look at a real deck's land suggestions.
- [ ] **`find_replacements` with `card` but no `deckId` (P07c).** It used to crash; it now says to
      give a `deckId`. Decide whether to make it work without a deck (P09).
- [ ] **`find_replacements` ignores `where`, `limit` and `maxPriceCents` on the card form (P07c).**
      Decide to fix or drop them (P09).

## Known gaps in the tests themselves

- [ ] `checkOwnedCards` is a thin forward in `capabilities.ts` with no unit test; it becomes a real
      capability when P18 moves its query.
- [ ] The comparisons of old and new tools (P06 to P07d) were throwaway scripts, deleted with the
      old tools. The reference outputs in `reference/tools/` are the lasting record; they cover one
      input per tool. Consider adding a few more fixtures before P09 deletes the last old tools.
- [ ] **Builder panels after P09b** (by eye, with real data): swap a cut for a suggestion, take a
      card from another deck, save, compare, restore and delete a snapshot, edit the plan and primer,
      run the optimizer, a draft and the mana base. They go through the same wrapper the e2e suite
      covers, but no test drives them.
      **Partly done 2026-11-19 (milestone 1 review, e2e database, admin):** every panel opened with no error (suggestions, cuts, mana base, draft, test hand, snapshots, tokens, plan); snapshot save, compare and delete; add a card and remove it (kept after reload); plan saved and kept after reload. **Still open:** swap a cut for a suggestion, take a card from another deck, restore a snapshot, the optimizer, all with real data.
- [ ] **Pages moved in P09c, by eye** (dark theme, desktop and phone): drafts list and a draft in
      progress (lobby, picking, finished), inventory and opened packs (with the animation), a
      card's page, the Game and Real collection tabs, a shared deck and its public link and
      scorecard, the proxy print page and a PDF download, the commander finder.
      **Partly done 2026-11-19 (milestone 1 review, e2e database, admin):** every page reachable from the home page (80) plus admin, the PDF, OAuth consent and players' pages answered 200 with no error text and no server error; drafts (finished) checked by eye in dark at phone width. **Still open:** a draft in progress, the opened-pack animation and the public `/d/` link, by eye with real data.
- [ ] **Pages moved in P09d, by eye** (dark theme, desktop and phone): the site header's counts
      (trades waiting, wishes on target, a draft you're in, friend requests), account (profile,
      tokens, password change after a reset), wallet, trades (new, open, history), friends, wishlist
      and a friend's wishlist, singles, sets, store, a player's pages, every admin page, and the
      OAuth consent flow with a real connector.
      **Partly done 2026-11-19 (milestone 1 review, e2e database, admin):** all of these pages load without errors (same crawl); admin players and a trade checked by eye in dark at phone width; admin pages still require an admin (each checked against the old code). **Still open:** the header counts with live data, password change after a reset, and OAuth with a real connector.

## Left by P19 (builder UI split, by eye and in the browser)

- [x] **Done 2026-11-19, merge of P19, e2e database: full Playwright suite 26 of 26.** **Run the e2e builder flows (P19).** `pnpm test:e2e tests/e2e/<the builder specs>` (or the
      whole suite): nothing in the builder was driven in a browser in the package.
- [ ] **Partly done 2026-11-19, merge of P19, e2e database: dark mode, phone width, a 40-card draft deck: stats, curve, colors and roles fine, no horizontal scroll. Still open: real data and the keyboard shortcuts.** **Look at the builder in dark mode and at phone width (P19)**, with real data: the collection
      grid (filters, sort, card size S/M/L, "Show cards that don't fit", scrolling loads more),
      selecting a card from the grid and from the deck list (sheet sticks to the bottom on a wide
      screen, floats over the tab on a phone), arrow keys in the grid, Enter on the selected card,
      "+" and "-" for the quantity, "/" to search, "H" test hand, "S" suggestions, Escape.
- [x] **Done 2026-11-19, merge of P19, e2e database: suggestions, possible cuts (swaps and optimizer), mana base and test hand opened with no error text.** **Each panel opens, loads and closes (P19):** suggestions, possible cuts, mana base, draft
      deck, test hand, snapshots, tokens, plan & primer, the bracket panel and the stats panel
      (highlighting a role or a bracket reason marks cards in the list, one at a time).
- [ ] **Partly done 2026-11-19, merge of P19, e2e database: a swap (moved the cut to maybe, added the card) and + / − on a card showed at once and were saved (checked in the database). Still open: undo on failure.** **Changes still show at once and undo on failure (P19):** add and remove a card, move to the
      maybeboard and back, set a heading, rename, reorder and clear headings, switch By type or By
      heading, note, role and pin, choose a printing, take a card from another deck, swap a cut for
      a suggestion, add lands from the mana base and the draft, change the target bracket.
- [ ] **A refused change undoes the guess (P19):** open the deck in two tabs, remove a card in one,
      then in the other set its note or role: the message shows and the deck goes back to the
      server's. (The deck now comes back inside the refusal instead of through `loadBuilderDeck`.)

## Left by P10 (formats as a strategy table)

- [ ] **Run `pnpm test:int` and the e2e builder flows (P10).** Not run in the package (shared
      database). `legalInFormat` (`queries/candidate-pool.ts`) now builds the legality condition for
      the builder's collection grid, suggestions, search for a deck and the mana base: check each
      still filters out cards that are not legal in a Modern deck, and shows everything in a Casual
      and a Limited one.
- [ ] **Look at the builder's stats panel and test hand in a Commander deck and a Limited deck
      (P10):** cards "n / 100" and "n / 40", the sideboard line only in 60-card formats, the role
      guide text, a free first mulligan only in Commander, no "Draft deck" button in Limited.
