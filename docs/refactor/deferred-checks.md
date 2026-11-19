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
- [ ] **Tools that call outside services were never exercised by the reference outputs:**
      `edhrec_lookup`, `find_combos` (Commander Spellbook), `rules_lookup` rulings,
      `youtube_research`, `reddit_research`. Check each still answers after P09 moves them.
- [ ] **Embedding-based `find_replacements` (budget path) and `similarCards` neighbours.** They
      read stored embeddings, not the network, but the fixture catalog has none: confirm with real
      data that the lists are not empty.

## Needs a browser (`pnpm test:e2e`, Playwright)

- [ ] **The Playwright suite has not been run since P05.** Run it once now and after each wave:
      the deck builder (P06 changed how it loads), the deck page and shared view, wishlist pages.
- [ ] **Look at it, dark mode and at phone width** (memory: user tests dark and mobile): the
      builder grid and the suggestions panel after P07b changed which printing an owned card shows.

- [ ] **Edit as text, the plan and primer panel, and new deck (P08).** In the browser: save a
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
