# decks: core (the deck itself)

The deck as a list of cards: boards, formats and what each requires, ownership, headings, notes,
snapshots, text round trips, sharing, and the Commander bracket estimate. Code:
`src/modules/decks/core/` (ADR 0029). Each rule below was checked against the code on
`refactor/main` (2026-11-20); the test or constant that holds it is in the file named in brackets,
where there is one. A rule is a product rule: changing it is a decision, not a refactor.

## Ownership and problems

1. **Ownership counts every copy, in every deck.** For each card, the copies across a deck's boards
   may not exceed the copies the player owns in any printing and finish. Basic lands are exempt.
   Another deck using the same card changes nothing; a deck shows which others use it. (doc 09 §4
   rule 1, doc 14; `ownedCardCheck`, `free-copies.test.ts`)
2. **Problems are reported, never enforced.** A short or illegal deck still saves. The same
   `deckProblems` runs in the browser and on the server; the server's answer replaces the browser's.
   (doc 09 §4 rule 5, doc 19 §4 rule 8; `rules.ts`)
3. **A deck with "use my real cards" on counts real copies plus game copies** as owned; with it off
   only game copies count. (doc 16 §5 rule 2)
4. **Maybeboard cards change nothing** about size, statistics, role counts, problems, the bracket
   estimate, shopping lists, proxies, test hands, free copies or the "already in the deck" check.
   A card may be on the maybeboard and a counted board at once. Moving a card there keeps its
   quantity and pinned printing; moving back goes to main. (doc 32 §4 rules 1-3;
   `rules.test.ts`, `free-copies.test.ts`)
5. **Only the owner** sees or changes a deck. To anyone else it is "not found", never "forbidden",
   so its existence does not leak. (doc 09 §4 rule 7, doc 21 §4 rule 1; `sharing.test.ts`)
6. **Limits:** deck name 1-60 characters, quantity 1-99 per entry (0 removes), at most 100 decks per
   player, at most 1,000 lines per text save. (doc 09 §4 rule 6, doc 23 §4 rule 8; `MAX_NAME_LENGTH`,
   `MAX_QUANTITY`, `MAX_DECKS`, `MAX_LIST_LINES` in `deck.ts`)

## Formats

Every difference between formats is one row of `FORMAT_RULES` (`format-rules.ts`); no file compares
a format's name (lint rule, refactor P10). The offered formats are casual, standard, pioneer,
modern, legacy, vintage, pauper, commander and limited.

7. **60-card formats** (standard, pioneer, modern, legacy, vintage, pauper): at least 60 cards in
   the main deck, sideboard at most 15, at most 4 copies of a card counting main and side together,
   except basic lands and "any number" cards; every card legal, a restricted card limited to 1.
   (doc 09 §4 rule 2, doc 44 §3.2; `rules.test.ts`)
8. **Commander:** exactly 100 cards including 1-2 commanders; singleton except basics and "any
   number" cards; every card inside the commanders' combined colour identity and legal. A commander
   is a legendary creature, a card that says it can be your commander, or a legendary Spacecraft or
   Vehicle with power and toughness. Commander has no sideboard limit. (doc 09 §4 rule 3, doc 44
   §3.2; `rules.test.ts`)
9. **Two commanders must pair:** plain Partner with plain Partner, "Partner with X" only with X,
   the same "Partner-Variant" with each other, Friends forever with Friends forever, "Choose a
   Background" with a legendary Background, a Doctor's companion with a Time Lord Doctor that has no
   other creature types. One commander, or three, has no pairing problem (three already reports
   `TooManyCommanders`). (doc 40 §2.1; `rules.test.ts`)
10. **Casual:** only the ownership rule; no size, copy or legality check. **Limited** (draft and
    sealed): 40 cards minimum, any number of copies, any card; a conspiracy in the main deck does
    not count toward the size (CR 905.4). (doc 09 §4 rule 4, doc 17 §4; `FORMAT_RULES`,
    `rules.test.ts`)
11. **Role targets exist for Commander (10 ramp, 10 draw, 8 removal, 3 wipe) and for the 60-card
    formats (4, 6, 6, 2); Limited has none.** See the disagreement noted under "Open decisions".
    (doc 19 §13.2, doc 44 §4 rule 1; `FORMAT_RULES`)
12. **"Which 60-card formats is this legal in"** counts main plus sideboard against each of
    standard, pioneer, modern, legacy, vintage and pauper. (doc 44 §3.2; `rules.test.ts`)

## Printings

13. **The printing shown for a deck line**, in order: the pinned printing; else the player's most
    special owned copy (most valuable first; at equal value Universes Within before Universes
    Beyond; then finish, frame...); else the standard printing (released, not Universes Beyond, not
    Secret Lair, a modern frame with normal border and no showcase or extended art, then expansion
    before core before Commander, then newest set, then lowest collector number). The ranking only
    chooses which copy is shown; ownership still counts every copy. (doc 23 §14.3, doc 24 §4
    rules 1 and 6; SQL fragments `MOST_SPECIAL_FIRST` and `STANDARD_FIRST`, exported by `decks/core`)
14. **Choosing a printing pins it, with a finish the printing has** (`FinishNotAvailable` otherwise,
    `PrintingNotOfCard` for a printing of another card). "Follow my copies" unpins. Quantity does not
    change. (doc 24 §4 rules 3 and 4; `deck-printings.ts`)
15. **A pasted card without a printing** is pinned to a printing the player owns, if any, otherwise
    the standard one. A line that names "(SET) number" always wins. (doc 09 §4 rule 8, doc 23
    §14.3 rule 1)

## Text and headings

16. **Saving a text list is all or nothing.** If any line is unreadable or names a card the catalog
    lacks, nothing is saved and every problem line is listed. "Replace" means the deck becomes
    exactly the text's cards, quantities and boards. (doc 23 §4 rules 1 and 2)
17. **The round trip changes nothing:** saving the text a box started with leaves cards, boards,
    quantities, printings, finishes and headings as they were. A line without "(SET) number" keeps
    the deck's existing printing. A heading line ("Commander (1)", "Sideboard") switches the board and
    is never read as a card; one line per card per board, whatever the art ("7 Forest" stays one line).
    (doc 23 §4 rules 3, 4, 7 and 9, doc 34 §4 rule 4; `deck-text.test.ts`)
18. **No lost edits:** a save from a stale view is refused with `DeckChanged`, using the deck's
    fingerprint. (doc 23 §4 rule 5; the tools use the same check)
19. **Headings group main-deck cards only,** one heading per card; a heading is never a board name;
    switching the grouping loses no heading; the grouping is saved on the deck, so a shared deck
    shows as its owner set it. Headings are in the owner's own order. A card with no heading, under
    custom grouping, shows in its usual type group after the headings. Problems, statistics,
    brackets, cuts and proxies ignore headings. At most 30 headings of at most 40 characters.
    (doc 34 §4 and §13; `headings.test.ts`, `MAX_HEADINGS`)
20. **Maybeboard in lists:** a `Maybeboard`, `Maybe` or `Considering` section goes to the
    maybeboard; export writes it back. Arena and MTGO formats leave it out. (doc 32 §4 rules 6 and
    7, doc 23 §13.2)
21. **Notes and snapshots.** A line note is null or trimmed single-line text of 1-200 characters
    and survives edits and moves. A deck holds at most 30 snapshots, each with a 1-60 character
    label; restoring is one transaction and keeps the existing snapshots; deleting a deck deletes
    its snapshots. (doc 41 §4; `notes.ts`, `snapshots.test.ts`)
22. **Change previews do not save.** A preview of a list of changes shows cuts, additions, moves,
    statistics, problems and the price difference, and nothing is written until it is applied by
    its id. (doc 40; `preview.test.ts`, `deck-previews.test.ts`)

## Sharing

23. **Playgroup sharing:** only the owner changes visibility; a deck is announced in the feed once,
    the first time it is shared. Comments need a deck the author can see now, are plain text 1-1,000
    characters, no edits, no replies; the author, the deck's owner or an admin deletes one, once;
    commenting on another player's deck records one feed event. The feed shows a deck's events only
    while it exists and is shared. Viewers get the list as text, not the owner's export or proxy
    pages. (doc 21 §4 and §13; `sharing.test.ts`)
24. **Cards to get** is, per card (never basic lands), the most any one deck needs minus copies
    owned, never a sum, so one copy serves every deck. (doc 21 §4 rule 6, doc 09; `free-copies.test.ts`)
25. **Public links** are separate from playgroup sharing: only the owner enables, rotates or revokes
    one; the token is 22-character base64url from 128 random bits; rotating or revoking makes the
    old URL 404 at once; enabling does not change visibility or announce the deck; `/d/[token]`
    needs no account, writes nothing and shows no ownership or comments. (doc 47-public §4;
    `sharing.test.ts`)
26. **Copying a shared deck** needs a deck the actor may see (own, shared, or a valid public token);
    it counts against the 100-deck cap; the copy is private, has no origin, link, pinned printings or
    notes, uses real cards, and keeps format, target bracket, grouping, headings and each entry's
    card, board, quantity and heading. (doc 48-copy §3)

## Commander brackets

The rule table lives in `BRACKET_RULES` / `brackets.ts` (Wizards' 9 Feb 2026 update). Game Changer
status comes only from stored Scryfall data, never a list in our code.

27. **One estimate:** the builder, shared decks, `get_deck`, suggestions and search all go through
    `estimateBracket`. The floor is the highest bracket any finding forces; adding a card never
    lowers it; it is never 5; non-Commander formats get null. Sideboard lines never count;
    commanders do. Every finding lists the cards that caused it. (doc 31 §4 rules 1-7;
    `brackets.test.ts`)
28. **What forces what:** Game Changers none in 1-2, up to 3 in bracket 3, any above; land denial
    (including Blood Moon, Back to Basics, Armageddon and Winter Orb families) forces 4; up to two
    extra-turn cards are fine in 2, three or more count as chaining; two-card combos are checked
    only when combo data is supplied, otherwise "unchecked". (doc 31 §13, doc 52 §4;
    `brackets.test.ts`)
29. **A target bracket** exists only on Commander decks (a format change clears it). Being over
    target is a warning, never a deck problem. With a target set, no card suggestion would raise
    the floor above it (`fitsTarget`). `bracketWarning` is null exactly when the floor is within
    the target or there is no target. (doc 31 §4 rules 8-11; `brackets.test.ts`)

## Open decisions (found while writing this page)

- Doc 09 decision 5 allows up to two commanders with no pair check; doc 40 added the pair check and
  the code follows doc 40. Not a conflict now, listed so doc 09's line is not read as current.
- Rule 11: doc 19 §13.2 (changed 2026-10-06) says role targets for Commander only; doc 44 and the
  code give 60-card formats targets of 4/6/6/2. Reported to the project manager as a decision.
