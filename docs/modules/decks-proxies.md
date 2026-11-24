# decks: proxies (printing a deck)

Proxy sheets as PDFs, the low-ink playtest card style, token proxies and the token and emblem
checklist. Code: `src/modules/decks/proxies/` (ADR 0029). Checked against `refactor/main`
(2026-11-20) by the tests named in brackets.

## Sheets

1. **Nine real-size cards (3 x 3) per page** on Letter and on A4, inside the margins, with the chosen
   gap; bleed (an extra image margin around each card) keeps 3 x 3 at every gap, fills the gap so
   neighbouring images meet, and never comes closer than 1/8 inch to the paper edge. (doc 14 §8.4;
   `proxy-sheet.test.ts`)
2. **A sheet prints every copy except basic lands (by default), copies your real cards cover, and
   the maybeboard.** Options: basics, one of each, no sideboard, fronts only. Coverage is by card
   across all boards. (doc 14, doc 16 §5 rule 2, doc 32 §4 rule 1; `proxy-sheet.test.ts`)
3. **Double-faced cards print last, each page of fronts followed by a page of their mirrored backs,**
   so a two-sided print or a sticker lines each back up with its front. Side by side is not offered.
   (doc 14 §8.4; `proxy-sheet.test.ts`)
4. **Foils** print on foil pages after the rest (double-faced ones too), and mix in by default.
   Cut guides are corner marks outside the cards, full lines along every card edge, or none.
   (doc 14; `proxy-sheet.test.ts`)
5. **Progress is monotonic:** the bar fills stage by stage, never goes backwards, and a stage with
   nothing to do counts as finished. (`proxy-progress.test.ts`)
6. **PDFs are made with `pdf-lib`** (approved). (doc 14 §8.5)

## Playtest style

7. **The style is chosen in the form, Scan stays the default.** A playtest card never draws outside
   its 2.5 x 3.5 inch box except its stripes in the bleed; all rules text is printed (if it does not
   fit at the smallest size the text box takes space from the art, down to none, never cutting text);
   stripe colours come only from the card's colours, or for lands from the mana they make, and a card
   with neither is grey; a missing art crop leaves an empty outlined art box and never stops the
   sheet; stripes are not offered on the scan style. Double-faced cards and double-faced tokens show
   a Mana-font DFC icon in the title bar and a bottom hint bar naming the other side (with its cost
   or stats). Cards with two faces on one side use dedicated frame strategies: Adventure/Omen gets
   an inset spell panel on the left and creature rules on the right; Prepare gets creature rules on
   the left and the inset prepare spell on the right; Split/Room/Aftermath gets two equal stacked
   half-cards; Kamigawa Flip rotates the bottom half 180 degrees. Sagas place chapters on the left
   and tall art on the right; Classes and Cases place tall art on the left and level/solve text on
   the right. Tokens, emblems and helpers get a centered title with a `TOKEN`/`EMBLEM`/`HELPER`
   badge, and textless tokens omit the empty text box even with art off. Each type bar shows the
   card's set symbol on the right using the Keyrune font, tinted by rarity. (doc 22 §4 and §13;
   `playtest-card.test.ts`)
8. **Filters never change an image's size,** and every output pixel is 0-255; images use `jpeg-js`
   with our own filter functions; mana symbols use the real Mana font artwork. (doc 22 §4 rule 4,
   §13.2 and §13.4; `art-filters.test.ts`)

## Tokens and emblems

9. **Every token printed is one the deck's printed cards make,** every token the deck's cards make is
   listed on the print page, printed unless left out, and tokens follow the cards on the same pages.
   Default **2 copies** of each (0-4 offered), art choices saved per deck, everything Scryfall lists
   included (emblems and helper cards, each with a checkbox). With 0 copies the sheet prints exactly
   the cards. (doc 25 §4 and §13; `token-proxies.test.ts`)
10. **A chosen token art is always a printing of that token;** a choice that no longer fits (the card
    left the deck, the token left the catalog) is ignored, not an error; a missing token image prints
    as a labelled box. Token art defaults to the token your card makes, then a later card's, then the
    newest printing. (doc 25 §4 rules 3-4; `token-proxies.test.ts`)
11. **Maybeboard cards make no tokens;** sideboard-only tokens are left out when the sideboard is.
    (doc 32 §4 rule 1, doc 42 §4 rule 1; `token-proxies.test.ts`)
12. **The checklist** classes tokens, emblems, double-faced tokens and helpers; its summary totals add
    up (`total = tokens + emblems + helpers`, and `= mainboard + sideboard-only`); an item is
    "sideboard only" exactly when no card that makes it is played. (doc 42 §4 rules 2-3;
    `token-proxies.test.ts`)
13. **The checklist is read through the deck overview with the actor,** so it has the deck's own
    authorization: the owner, or (for a shared deck) a viewer who may see it. (doc 42 §4 rule 4;
    `tokens/actions.ts`)

## Open decisions (found while writing this page)

None beyond what the project manager already tracks. The taller token art on playtest tokens (doc 25
§13.5) is built (`playtest-card.test.ts`: "gives a token with text taller art").
