# Drafts

Live booster drafts between players, with an optional pick timer, bots for an admin's testing, and
Conspiracy cards that change how a draft works. Code: `src/modules/drafts/`; the 40-card `limited`
deck rules are in `decks-core.md` (rule 10). Checked against `refactor/main` (2026-11-20) by the
tests named in brackets.

## The table

1. **At most one seat in an unfinished draft per player.** A draft takes 2 to 8 players; only the host
   starts or cancels; the host picks a booster, entry fee, seat count and a timer of 30-300 seconds or
   off (default 90). (doc 17 §4 rules 1 and 3, §14.2-3; `drafts.test.ts`, `draft.test.ts`)
2. **Every seat pays the entry fee** (the packs at store price, see `economy.md` rule 6); leaving a lobby
   refunds that seat, the host leaving refunds everyone, and once the draft starts there are no refunds.
   (doc 17 §4 rule 2; `drafts.test.ts`)
3. **At start seats are renumbered 0..n-1 in join order** and each seat gets its packs, opened with
   fresh seeds. Passing is left in rounds 1 and 3 and right in round 2 (with two players, the same
   seat). (doc 17 §4 rules 4 and 6; `draft.test.ts`)

## Picking

4. **Every card is picked exactly once,** and a seat picks only from the front of its own queue; a pick
   names the pack and slot, so a double click or an old tab gets `StalePick`. A pack with cards left goes
   to the back of the next seat's queue; a round ends when its packs are empty; empty packs are skipped.
   (doc 17 §4 rules 5-7; `draft.test.ts`)
5. **Each pick puts the card into the picker's collection in the same transaction** (source `draft`), so
   an abandoned draft still leaves everyone what they picked. (doc 17 §4 rule 8; `drafts.test.ts`)
6. **Basic lands are not drafted:** they are taken out of the packs and dealt to the people at the
   table, shared out to within one, the spares at random. (doc 17 §4 rule 15; `basics.test.ts`)
7. **Only the seat itself sees its current pack;** others see counts and whether a seat is away, never
   another seat's cards until the draft is finished. Every change bumps `version` and notifies browsers
   only if the transaction commits. (doc 17 §4 rules 13-14, ADR 0018)

## Timers and auto-picks

8. **With the timer on, a seat's deadline is the pick time after a pack reaches the front of its queue;**
   a seat with no pack has none; off means no deadlines and no automatic picks (the host can pick for
   an away seat). (doc 17 §4 rule 9; `timers.test.ts`)
9. **A seat with no heartbeat for 40 seconds is away.** At its deadline an away seat gets 2 minutes of
   grace while it has used less than 5 minutes of grace in the draft; otherwise (or if present but not
   picking) the server auto-picks. (doc 17 §4 rule 10, §14.3; `timers.test.ts`, `AWAY_AFTER_SECONDS`)
10. **Auto-pick is deterministic:** it ranks by rarity nudged by price (basics worth nothing), commits
    to colours slowly (nothing for three picks, fully by pick 13), keeps a second colour open and penalises
    a third, wants creatures and a smooth curve, and a tie goes to the earliest slot; the same logic
    builds the suggested deck. (doc 17 §4 rule 11, §14.4; `auto-pick.test.ts`)
11. **Bots are an admin's testing tool:** only an admin hosting a lobby adds them, paying each fee; a bot
    picks the moment a pack reaches it, never has a deadline, is never away; its picks go to the admin's
    collection; bots get no deck and a draft with bots posts nothing to the feed. (doc 17 §4 rule 16;
    `draft.test.ts`, `drafts.test.ts`)

## Finishing

12. **A finished draft gives each player a `limited` deck** of their whole pool (suggested 40-card main
    deck of the best 23 spells in two colours plus 17 basics by pips, the rest sideboard), unless they
    are at the 100-deck limit, and tells the feed. The deck shows the basic printing the player owns
    most of; missing basics are given for free but never past 30 of one basic land. (doc 17 §4 rules
    12 and 17, §14.5; `suggested-build.test.ts`, `basics.test.ts`, `drafts.test.ts`)
13. **Reload and rejoin work at any time;** nothing lives only in the browser. (doc 17 §14.6)

## Conspiracy drafts

14. **The draft-matters cards follow CR 905,** built in full to emulate a real draft: the order players
    act is the order their transactions take the draft lock; "reveal as you draft" facts are visible to
    everyone for the rest of the draft; face-up cards stay face up until the draft ends; cards removed
    from the draft (Cogwork Grinder, Animus of Predation) stay in the drafter's collection but out of the
    pool and deck; Lore Seeker's pack is an unopened booster from inventory or one bought at store price,
    from any set the app can open, its basics dealt out as in rule 6; a Canal Dredger drafter who cannot
    draft takes a last card passed to them anyway; a draft with these cards always finishes with every
    card drafted exactly once. (doc 18 §2 and §8; `conspiracy.test.ts`)

## Open decisions (found while writing this page)

- `FREE_BASICS_CAP`, the timer constants and the away threshold are constants, not host settings
  (doc 17 §14.3); doc 17 does not give the 40-second away threshold, the code does.
