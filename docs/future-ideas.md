# Future ideas

Things we may change or add later: requests that were deferred, limits we know about, and
improvements noticed along the way. Nothing here is scheduled. When one is picked up, it gets a
design doc (or joins a phase's design) and is removed from this list.

## Pack opening

- **Special pack rules that MTGJSON's recipes can't express.** (Requested 2026-09-27.)
  Example: **Reality Fracture** play boosters reportedly guarantee _matching Echoverse pairs_.
  MTGJSON describes a pack as independent draws from weighted sheets (plus fixed sheets and
  color balance), so "these two slots must hold a matching pair" can't be written in its format.
  - **Status (2026-09-30): handled by the data.** MTGJSON's FRA Play Booster recipe has 232
    variants, each with a fixed two-card sheet holding one matched pair (`pairChandra`) and a
    third-card sheet without that pair (`thirdNotChandra`). The engine opens these correctly,
    and `check-packs` passes. The fix needed was rule 3b in design doc 05 (no repeats between
    slots of one rarity), which FRA's common-or-uncommon slot exposed.
  - **If the data can't express it:** add a small, per-set "booster rule" step after
    `generatePack` (e.g. `pairEchoverse(pack, rng)`), chosen from a table keyed by set and
    booster type (the same Strategy table idea as the sheet drawers). Each rule gets its own
    statistical test, and `check-packs` checks it on real data.
  - Other rules to look for in the same pass: guaranteed "one of each" slots, serialized-card
    odds printed on the box, and Jumpstart theme packs (MTGJSON uses fixed sheets for these).
- **Animated foil effects** beyond the still sheen: Phase 8 adds the animated shimmer on reveal.
  A later pass could show different foil treatments (surge, galaxy, fracture foil) differently,
  using the printing's promo types.

- **Spoiler-proof reveals:** fetch each pack's cards only when it's torn open, so they aren't in
  the page source beforehand.
- **Real sound effects** (CC0 files) to replace the generated ones, and a volume slider.

## Catalog and images

- ~~Real product photos~~ **Done (design doc 13):** Wizards' official photos and key art from
  Wizards Play Network, with generated art as the fallback. Still open: **photos for Commander
  decks one by one** (WPN's per-deck box photos aren't labeled; an admin can assign them), and
  products WPN doesn't list (tins, Commander kits, welcome decks).
- **Image cache warming**: fetch a set's small images in the background after it's enabled,
  politely rate-limited, so the first visit to a set page isn't slow.
- **In-flight image de-duplication**: if two people ask for the same uncached image at once,
  fetch it once.
- **`POST /cards/collection` fallback** for printings missing from Scryfall's bulk file (not
  needed so far: the bulk file covered every English paper printing).

## Collection and store

- **Serialized cards as individual copies** with their own serial number ("#127/500"), as ADR
  0011's option (b). Today they're ordinary stacks.
- **Bulk selling:** "sell everything above 4 copies" or "sell all commons under $0.10", with a
  preview of the payout.
- **Wishlist and price alerts** from the price history.

## Decks

- **More formats** (brawl, oathbreaker, historic…), and partner and background checks for Commander.
- **More deck statistics:** color pips and a draw simulator (the curve, types and average mana
  value are in the builder).
- **Sharing decks** with the playgroup (read-only links), and a "cards to get" list across all
  your decks.
- **Strict ownership as an option:** a copy used by one deck can't be used by another.

## Trades

- **A client-side trade builder** (no page load per "+ add"). The draft race it would have fixed
  is fixed already (design doc 10, section 13).
- **Trade expiry** after N days, and a cap on open proposals per player (lesson 10's exercises).
- **Notifications** beyond the badge (e-mail isn't set up; a feed item comes with Phase 11).

## Players and economy

- **Public player profiles**: history, total spent, self-funded amounts. The ledger already
  records everything needed.
- **Config error messages** could suggest `direnv reload` when a variable is missing (declined
  for now).

## Testing

- **Remote test suite** (`pnpm test:remote`, never run by default): a handful of checks against
  the real MTGJSON and Scryfall endpoints, to notice when their formats change. Automated tests
  stay offline (recorded fixtures, local image responses).

## Deck building (out of scope for design doc 14, 2026-09-30)

- **Suggestions:** "cards like this" and "cards that go with your commander", from your own
  collection first.
- **Price-based recommendations:** the cheapest singles that would complete a deck, or upgrades
  within a budget.
- **Automatic tags** like ramp, card draw, removal and board wipes (from rules text), with counts
  in the deck statistics.
- **Sharing decks publicly** (a read-only link), and deck comments.
- ~~**"I have a real copy" per deck line**~~ **Planned (design doc 16):** the real collection,
  and a proxy option to leave out cards you own for real.
- **Problems checked in the browser** as cards are added (`deckProblems` is pure), instead of
  when the server answers.

## Real collection (out of scope for design doc 16, 2026-10-01)

- **Undo last import:** keep each import's changes so the newest one can be reversed in one
  click. Re-importing the right file does the same job until then.

## Drafts (out of scope for design doc 17, 2026-10-01)

- **Bring your own packs:** join with three unopened packs from your inventory instead of paying
  the fee. A seat's `packSource` already has room for `{ kind: "ownPacks"; itemIds }`; the
  inventory would need a "reserved" state so committed packs can't be opened elsewhere.
- **Other draft styles:** cube, Rochester, Winston, sealed. Each is a new row in `DRAFT_STYLES`
  plus whatever it moves differently (a cube needs a card list instead of boosters).
- **Bots in empty seats**, using the auto-pick's scoring.
- **Pairings, match results and prizes** after the draft.
- **A shrinking pick timer** (fewer seconds as the pack empties, like MTGO) and host-set grace.
- **Kick a player from a lobby** (with a refund).
- **A pick-by-pick replay** of a finished draft: every pick, pack and seed is already stored.
- **Limited ratings** (a ratings table per set) to replace rarity and price in `cardStrength`.
