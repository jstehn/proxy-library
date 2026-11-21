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

## Left by P16 (one mana curve)

- [x] **Done 2026-11-19 (merge of P16 and P17, e2e database):** eight bars, 0 to 7+, dark at phone width, no horizontal scroll. **Look at the draft page's pool curve (P16):** the little bar chart under "Your pool" now has
      eight bars, labelled 0 to 7+ (it had six, 1 to 6+). Check it in dark mode and at phone width.
- [ ] **Open a "Draft a deck" result and read the curve reasons (P16):** each curve pick says "3 mana
      curve slot", and the last says "7+ mana curve slot" (the old text was "1-2", "3", "4", "5+").
- [ ] **Play a short draft against the bots (P16):** the drafter now counts curve slots 0 to 7+ by
      rounding down, so its picks can differ a little from before. Nothing here is a bug; check they
      still look sensible.

## Left by P17 (one way to show a collection)

- [x] **Done 2026-11-19 (merge of P16 and P17, e2e database):** the full integration suite, 281 of 281. **Run the integration tests for the shared collection SQL (P17).** `pnpm test:int
tests/integration/singles.int.test.ts tests/integration/collection-real.int.test.ts
tests/integration/card-search.int.test.ts`, plus whatever covers the card page's "owned" boxes and
      the exports (`grep -l "exportRows\|ownedByOracle\|copiesOf" tests/integration`). Not run in the package
      (shared database).
- [ ] **Partly done 2026-11-19:** all three pages (with sort and page) answer without errors; `/collection` checked by eye in dark at phone width. Still open: the real collection with real data. **Look at `/collection`, `/collection/real` and `/players/<id>/real` in dark mode and at phone
      width (P17):** the grid, sections, the "In: deck" line (game tab only), filters, sort "Newest
      first", pagination, and the export links.
- [x] **Done 2026-11-19 (merge of P16 and P17, e2e database):** all six downloads answer with the right file names and headers (Moxfield CSV, text list, full CSV with first and last acquired). **Download all three formats from `/api/export/collection` and `/api/export/real` (P17):**
      file names (`collection*.csv/.txt`, `real-collection*.csv/.txt`), and the first and last acquired
      dates (game: first and last arrival; real: when added, when changed).

## Left by P28 (cast by turn: the chart and the tool)

- [x] **Done 2026-11-20 (e2e database, a 59-card Commander deck, dark at phone width): the commander chart loads below the mana curve (0, 0, 0, 89 … 100; median turn 4), labels fit at 375px; a selected card's "When can I cast this?" shows its own chart (Brightblade Stoat: 60% by turn 2, misses "not drawn 16%"); no horizontal scroll.** **Look at the "Castable by turn" chart in the deck builder (P28), in dark mode and at phone
      width.** Open a Commander deck's builder: the stats panel, below the mana curve, should load a
      10-bar chart ("Castable by turn (2,000 simulated games on the play, ±2.2 points)") with the
      median turn and the usual misses. Bars climb with the turn; labels don't overlap at 375px;
      "Run again" gives the same numbers (seeded). A deck with no commander shows no chart.
- [ ] **Select a card in the builder and press "When can I cast this?" (P28).** Same chart inside the
      card view; it loads only on the press, and selecting another card resets it to the button. Try a
      land, a 1-drop and a 7-drop: the chances should look sensible (a 7-drop low until turn 6 to 8).
- [ ] **Ask the `draw_sample` tool for `cast: ["commander"]` on a real deck (P28)** and read the
      table: one `T<n>` line per turn, the median turn and the misses line.

## Left by P31 (UI blocks, colour tokens, the phone card view: all by eye)

No browser was available, so none of this was looked at. Do each in dark mode, light mode and at
phone width (375), and note long names and empty lists. Colours now come from tokens in
`globals.css` (`border-line`, `border-border-subtle`, `text-muted`, `bg-accent`, `bg-surface`,
`bg-surface-raised`, `bg-field`, `*-danger/-success/-warning` families); the dark values are the
old `dark:` ones, so nothing should have moved.

- [ ] **CardView, the three modes (new feature).** At phone width: tap a card in a card grid (the
      dialog opens), in the deck builder list (the selected-card sheet), and open a card page
      (`/cards/<id>`). Image only is the first view: the image is large, the text is not on screen.
      "Text" shows the type line, rules text and stats with no image. "Both" shows the image above
      the text. The choice is remembered after a reload and shared by every card view on the page;
      a private window falls back to "Image". The toggle is a labelled group of three buttons
      (`aria-pressed`); with a screen reader the text is still read while "Image" is chosen.
- [ ] **CardView on desktop (768 and wider).** No toggle; the card page, the builder sheet and the
      hover preview look as before (image left, text and details right). The builder's text box is
      now themed (it was a dark panel in both themes): check it in light and dark.
- [ ] **Builder sheet at phone width.** The selected card's sheet floats over the tab and scrolls;
      with a large image, check the facts, Add to deck / Sideboard / Maybe buttons and the "When can
      I cast this?" chart (P28) are reachable by scrolling, and the chart still loads only on press.
- [ ] **Card dialog (touch).** Tapping a card on a phone opens the dialog: close button reachable,
      image fits at 375 wide, the mode toggle works, the dialog scrolls in "Both".
- [ ] **Buttons.** Every migrated button has the same size as before, except these small changes:
      primary and danger buttons are always `font-medium`; secondary buttons have a hover tint;
      disabled buttons fade to 60% (some were 40%); buttons that had no `text-sm` now have it.
      Look for wrapped labels in rows of buttons (deck builder sheet, trades, admin).
- [ ] **Fields.** Text fields, selects and textareas now share one look (`bg-transparent`, same
      border). Some were `bg-field` (white / zinc-900): look in dark mode for fields that now show
      the page colour instead (drafts, the login and account forms, admin money form). The login
      and account `TextField` is a little different: `bg-transparent` instead of `bg-field`.
- [ ] **Areas to walk through (dark + phone each):** sign-in and account (password, profile,
      tokens, start over), wallet, store and a set page, singles and "buy a list", collection
      (game and real, import), cards page, wishlist, trades (list, new, one trade), friends and
      players, admin (catalog, packs, store, photos, players, invites, connectors), drafts list and
      the conspiracy panel, decks list, one deck page, commanders, every deck builder panel (stats,
      cuts, tokens, test hand, primer, snapshots, draft, bracket), home page, the site header.
- [ ] **Chips and labels.** The `Badge` tones (sky, violet, amber, green) in the deck list, the
      builder tokens panel and the selected card's role and bracket chips; the small uppercase
      headings (`Eyebrow`) in the builder panels.
- [ ] **Left alone, still raw colours:** `pick-grid.tsx` (P20's) keeps three long class strings and
      its own `field` string; check it still looks as it did.

## Left by P32 (page states, thin pages, every action written one way: all by eye)

None of this was run in a browser (`next build` and e2e can't run in the agent's worktree).
Check each in **dark mode and at phone width (375)** unless it says otherwise.

- [ ] **Error page.** Make a page throw (stop Postgres with `pnpm db:stop`, open `/wallet`).
      Expect "Something went wrong", one plain sentence, a "Try again" button and "Go home"; no
      error text and no stack. "Try again" reloads the page once the database is back.
- [ ] **Not-found page.** Open `/decks/999999` and `/nowhere`. Expect "Not found", "There is
      nothing at this address, or it belongs to someone else.", and "Go home". The header and
      footer stay. Check `/d/<bad token>` too.
- [ ] **Loading states.** Throttle the network (or add a delay) and open `/decks`, `/drafts`,
      `/collection`, `/store`, `/admin` and another page (the root skeleton). Expect grey bars the
      width of the page, no layout jump when the page arrives, and "Loading" read by a screen
      reader.
- [ ] **Find a commander.** The list, filters and "Show more" look as before. "See the cards"
      (now `GET /decks/commanders/cards`): opens, shows "Looking through your cards…", then the
      three sections; a bad `oracleId` shows "Couldn't look this commander up." "Start a deck"
      opens the new deck (with "real" on when the box was ticked).
- [ ] **A draft, all five stages** (lobby, drafting, dealing, finished, cancelled), including the
      pick grid, the "Pick" and "Done" buttons (now `Button`: `font-medium text-sm` everywhere;
      "Draft at random" gained `text-sm`), the select and text fields in the ability choices
      (now `bg-transparent`, not `bg-field`), and a foil card's sheen.
- [ ] **A player's profile** (`/players/<name>`): friend, pending, incoming and self views; bio,
      colours, showcase, stats, shared decks, wishlist.
- [ ] **Each migrated form shows the same messages, colours and redirects.** Do each once; for
      the ones with an error, trigger it.
  - Decks: create (empty name, then 11th deck), rename (empty name), "use my real cards", delete,
    import a list (the `?imported=` banner), share and unshare, public link on, rotate, off, copy
    a deck, copy a public deck (at the deck limit), post and delete a comment (`#comments`).
  - Drafts: create (no set chosen), join, leave, start, each Conspiracy form (colour, Sneak,
    Informant, Deal Broker steps, end deals), act for an away player, add and remove a bot, make
    a deck from the draft. An unreadable form now goes to `/drafts`.
  - Trades: propose with bad money ("Enter money like 2.50."), propose, counter, accept, decline,
    cancel. Add and remove cards in the builder.
  - Wishlist: add (no printing: "Choose a printing and finish."; bad quantity: "Choose how many
    copies you want."; bad price: "Write the target price like 20 or 19.99."), update, remove
    (silent), share toggle, buy (a rise in price, a filled wish: the `?bought=` banner), "wish for
    short cards" for a deck and for all ("That deck is gone.", "Nothing to wish for: you own it
    all."). The forms start with no message and show success in green and errors in red.
  - Real collection: sharing toggle, clear, set copies and change printing on a card page
    (`?realError=`), remove a product with and without its cards, "I own this for real" on a set
    page, the importer.
  - Inventory: open one item, open all, the "ItemNotFound" error.
  - Admin: store (kind price, product price, mode, buylist rate: a bad price, a bad percentage),
    photos (choose, undo, set slug), catalog (set on/off, sync, "enable Standard"), connectors
    (create, delete), players (each intent, temporary password), invites (create, revoke).
  - Account: change password (empty, wrong password, success; and as a player who must change
    it, which now goes to `/` on success), tokens (create shows the secret once, revoke), profile
    (save, bad showcase deck), link and unlink Authentik.
  - Friends (send, accept, decline, cancel, unfriend: silent) and the OAuth approval page
    (approve with scopes, deny, too many tokens).
  - Sign-in (keeps the typed username after a wrong password, `?next=` honoured) and register
    (keeps typed values after an error).
- [ ] **Moved files.** The pack opener (`/inventory/opened`) plays as before; the collection
      (game and real) and a player's real collection sort and section as before.
- [ ] **Run `pnpm test:e2e`.** `tests/e2e` was not touched, so a changed message or redirect shows
      up there first.
- [ ] **The commander finder's orderings (P36 part 2), in dark mode and at phone width.** The select
      reads "Blend of popularity and power" by default and the "ordered by …" line matches;
      `?sort=coverage` shows "Reset filters"; with a real collection the blend lists popular,
      strong commanders first even when few of their cards are owned.
- [x] **Done 2026-11-21 (e2e database, 390px): the delete-deck dialog fits, its danger button shows
      the focus ring in dark mode, Escape closes it and focus goes back to "Delete this deck"; the
      focus ring shows in light mode.** Still open from P33: a full colour-contrast pass by eye; the
      broken-image tile (it only appears for images that fail after the page is interactive); the
      confirm button has no "working…" state.
- [x] **Fixed the same day: the scorecard now links to the full list for its legality issues, and the photos table has column padding (+11 lines).** Small things found in the final check by eye (2026-11-21): the scorecard
      (`/d/[token]/scorecard`) prints the raw kind "1 legality issue(s): WrongSize" instead of the
      sentence the deck page uses; on `/admin/photos` at 390px "No page found" runs into "0 of 0".
      Test gaps closed the same day: `setPageSlug` and `choosePhoto` (admin sets a slug, a bad slug,
      an unknown set and a player are refused; admin picks a photo, a player and an unknown product
      are refused) in `catalog.int.test.ts`; the drafts use cases `decideCard` and `answerDeal`
      (happy paths, not seated, not your turn or deal, already decided) in
      `drafts/application/conspiracy-answers.test.ts`. The two form actions themselves (the Zod
      form and the redirect message) are still only covered by e2e.
