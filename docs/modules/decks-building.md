# decks: building (making a deck from what you have)

The things that help fill a deck: browsing every card, the mana base plan, "Commanders I can
build", draft-a-deck, search for a deck, and the replacement finder. Code:
`src/modules/decks/building/`. Cards are ordered by the one scorer described in
`decks-scoring.md`; this page holds what building adds on top. Checked against `refactor/main`
(2026-11-20) by the tests named in brackets.

## Browsing

1. **"My cards" is the default source, every time.** The grid starts on "My cards" and the choice
   is not remembered; "All cards" shows each card (one per oracle card) that has a printing for
   sale and matches the search, colours and legality filter, owned cards included with their real
   count. With "My cards" the results are exactly the owned cards. (doc 29 §4 rule 1-2, §13.1)
2. **The shown printing** for an owned card is the player's most special copy; for a card not owned
   it is the standard printing (see `decks-core.md` rule 13), chosen among the printings that match
   the search, shown nonfoil when a nonfoil exists, at that printing's latest price. Printing-level
   terms (`s:`, `r:`, `is:foil`) match a card if any printing for sale matches. (doc 29 §4 rules
   3-5, §13.2-3)
3. **The source never changes what a deck accepts.** Adding an unowned card saves the same entry as
   an owned one, and the deck shows it as short. Adding from the grid pins the shown printing.
   (doc 29 §4 rule 7, §13.4)
4. **The colour filter** is on by default only for Commander decks (the commander's colour
   identity), and the player can toggle any colour or colourless in any deck. (doc 14 §8.2)
5. **A deck line owned in more copies than you own** is allowed and marked. (doc 14 §8.3)

## Mana base

6. **The plan never goes past the land target:** `lands + added = max(lands, target)`. A deck at or
   over its target adds nothing and reports by how much it is over. The target stays within the
   format's usual count minus 4 to plus 3, and its reasons add up to it (it follows the curve, drops
   a land for each three rocks and dorks past nine, at most three, and stays 17 for Limited).
   (doc 35 §4 rules 1, 2, 8; `mana-base.test.ts`)
7. **Every land it adds is playable and owned:** within the commander's colour identity, never more
   copies than you own (counting every copy, even ones other decks play), one copy in Commander,
   owned non-basics before basics, untapped before tapped (a tapped dual still beats a basic),
   skipping a land that makes none of the deck's colours. Wastes for a colourless deck. (doc 35 §4
   rules 3-4, 6; owner decision: decks share cards, `mana-base.test.ts`)
8. **Source targets** exist only for colours the spells use, are each at least the heaviest-cost
   floor, aim for at least 12 sources of a splash colour and more for colours a card needs twice or
   three times. Lands already in the deck are kept and counted; the plan only adds. (doc 35 §4 rules
   7 and 10; `mana-base.test.ts`)
9. **Store lands** appear only as "consider buying", at most five, never also in the add list, and
   not ones you own or the deck plays. The plan is deterministic (ties by name). (doc 35 §4 rules 5
   and 9; `mana-base.test.ts`)

## Commanders I can build

10. **Every candidate can lead a deck** and is legal as a commander. Only on-colour cards count, never
    the commander itself, and **every copy you own counts, whatever deck it is in** (another deck
    only shows up as a note). Lands never count as spells. (doc 36 §4 rules 1-5; owner decision:
    decks share cards, `commanders.test.ts`)
11. **Coverage is capped:** spell slots at 62, on-plan cards counted up to 30, each role's count at its
    target. Store legends appear only when asked, always with a price and marked not owned. Order is
    deterministic: score, then owned first, then name. The only write is "Start a deck", which
    creates a new deck. (doc 36 §4 rules 5-8; `commanders.test.ts`)
12. **Filter and sort:** filter by theme (umbrella themes include their sub-themes, such as
    politics and tokens) and by tribe (case-insensitive, matching the plan's tribes or the
    commander's own creature types); sort by coverage, popularity (EDHREC rank, unranked last),
    power or a combination. (doc 39 §3; `commanders.test.ts`)

## Draft a deck

13. **Commander and 60-card fill.** Exactly 100 cards when the pool allows (never past
    `max(100, existing)`; a deck already at 100 gets nothing); 60-card formats draft playsets up to the
    copy limit, with 60-card role targets, and a restricted card at most once. No `oracleId` repeats
    in a singleton draft except basic lands. The result does not depend on the order candidates
    arrive in. (doc 37 §4 rules 1-3 and 7, doc 44 §4 rule 2; `build-from-collection.test.ts`)
14. **Owned before store,** per role, and a card counts toward every role it fills so roles are not
    over-drafted; with "owned only" no store card is drafted and the store cost is 0. Store cards
    that tie on fit are chosen cheaper first. The draft never buys anything: store cards are listed
    to get. (doc 37 §4 rules 4-5; `build-from-collection.test.ts`)
15. **Colour identity, legality and the target bracket are respected** by the candidate query, and the
    curve is filled slot by slot, each reason naming its slot. (doc 37 §4 rule 6; `build-from-collection.test.ts`)

## Search for a deck

16. **Every result is within the commander's colour identity** (when there is one), legal in the
    deck's format (unless casual), and not already on any of the deck's boards; avoid cards are left
    out and named. Results list every synergy they matched, once each, ordered by more synergies,
    then owned, then cheaper, then name, and the order only rearranges the same cards. An empty or
    capped query says what to loosen or narrow. (doc 28 §4 rules 12-14, doc 61 §4 rule 4;
    `search-for-deck.test.ts`, `deck-search.test.ts`)
17. **"Find replacements"** leaves out the deck's own cards and returns ideas, not scores (see
    `decks-scoring.md` rules 16 and 20). (doc 53, doc 61; `find-replacements.test.ts`)

## Open decisions (found while writing this page)

- Doc 37 puts 60-card formats out of scope for draft-a-deck; doc 44 brought them in and the code
  follows doc 44. Listed so doc 37's out-of-scope line is not read as current.
- Doc 39 gives the commander coverage and power scores as formulas; the code keeps its own
  `COMMANDER_WEIGHTS` table (`commanders.ts`), a second weight table beside `RATING_WEIGHTS`.
  Whether it should merge into the one scorer is not decided here.
