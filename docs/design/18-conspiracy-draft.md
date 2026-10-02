# Design: Conspiracy drafts (draft-matters cards)

- **Phase:** 18
- **Status:** **Approved** (2026-10-02, with the decisions in section 8)
- **Related:** design doc 17 (live drafts), Comprehensive Rules **905** (Conspiracy Draft), the
  official rulings of each card below (Scryfall, 2026-10-02)

## 1. Purpose & scope

Requested 2026-10-02: draft **Conspiracy** (CNS) and **Conspiracy: Take the Crown** (CN2) the way
they're drafted at a real table, with their **draft-matters cards** working. This document pins
down, card by card, **when** each ability happens and **who it holds up**, before anything is
built.

**Findings that shape the design:**

1. Both sets have a MTGJSON `draft` booster recipe: 15 cards, one from a dedicated
   conspiracy/draft-matters sheet. The pack engine opens them as they are. The sets just need
   enabling and a sync, and a pack price.
2. **Nothing in these sets waits for the end of a draft round.** Every ability happens during a
   pick (the drafter's or someone else's), as a free action, at a later "next" pick, or right after
   the draft. The round boundary only ends one restriction (Agent of Acquisitions) and resets the
   "cards drafted this round" counts.
3. **Some information is public** (CR 905.2b–c): face-up drafted cards, and everything noted for a
   card, can be seen by every player at any time. Design doc 17's rule 13 ("other players never see
   your cards") gets these two exceptions.
4. **One pick can draft several cards** (Cogwork Librarian, Agent of Acquisitions, Canal Dredger),
   and a drafted card can go **back into a pack** (Cogwork Librarian). The draft must track
   **card instances that move**, not "slot N of pack M, picked or not".
5. **25 Conspiracy-type cards** (13 in CNS, 12 in CN2) start the game in the command zone, not
   the deck (CR 905.4). The suggested build and the deck builder must leave them out of the 40.

**Out of scope:** anything that happens in the game (the conspiracies' own effects, "before you
shuffle your deck" abilities). Those are played at the table, and the app only has to keep the
cards in the pool.

## 2. Ground rules from CR 905

- **905.1a–b:** draft one card at a time into a face-down pile; rounds pass left, right, left.
- **905.1c:** a player may look only at the pack they're drafting from, their own drafted cards,
  cards currently revealed, and cards drafted face up.
- **905.1d:** a player's card pool is fixed only **after the draft and all actions taken during
  or after it** (Deal Broker happens after the last pick and before deck building).
- **905.2a:** there's no priority during a draft. Actions players want at the same moment
  happen in a random order. For us, the order transactions take the draft lock is that order.
- **905.2b:** "reveal as you draft" cards are shown, their information noted (visible to every
  player for the rest of the draft and the game), then turned face down into the pile.
- **905.2c:** "draft face up" cards stay face up until the draft is complete, until an effect turns
  them face down, or until they leave the pile. While face up, everyone can see them.

## 3. Timing, card by card

**When**, using these terms:

- **As drafted:** while this card is being drafted, before the pack moves on.
- **Each later draft:** whenever its drafter drafts another card while it's face up, in any round,
  until the draft ends.
- **Next…:** waits for a specific later event, which may come in a later round.
- **Any time:** a free action not tied to a pick.

**Holds up** says who, if anyone, waits.

| Card                                                                                 | When                                                      | What happens                                                                                                                                                                                                                                                                                                                         | Holds up                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Lurking Automaton**, **Pyretic Hunter**, **Garbage Fire**, **Custodi Peacekeeper** | as drafted                                                | Revealed; note how many cards you've drafted **this round, including it**. Counts **cards**, not picks: extra cards (Librarian, Agent, Dredger) and cards removed by Grinder/Animus count (rulings: "you still draft the card that you remove").                                                                                     | nobody                                                        |
| **Cogwork Tracker**                                                                  | as drafted                                                | Revealed; note the player who passed it to you. None if it came from a pack you opened (ruling).                                                                                                                                                                                                                                     | nobody                                                        |
| **Paliano, the High City**, **Regicide**                                             | as drafted                                                | Revealed; then **the player to your right** chooses a color, **you** choose another, **the player to your left** chooses a third (all different). With two players, right and left are the same person.                                                                                                                              | your two neighbors and you, briefly; see section 5            |
| **Aether Searcher**                                                                  | as drafted, then the **next card you draft**              | Revealed. The next card you draft (any pack, **even in the next round**) is revealed and its name noted. If it was your last card, nothing is noted.                                                                                                                                                                                 | nobody                                                        |
| **Cogwork Spy**                                                                      | as drafted, then the **next card drafted from that pack** | Revealed. You may look at the next card anyone drafts from that pack, even one removed by Grinder. Does nothing if you're the next to draft from it (Librarian) or the pack is empty.                                                                                                                                                | nobody                                                        |
| **Spire Phantasm**                                                                   | as drafted, then the **next card drafted from that pack** | Revealed. You guess the name of the next card drafted from that pack; its drafter then **reveals it to everyone**. You may guess before they pick (ruling), so we ask for the guess **as you draft the Phantasm**. Nothing if the pack is empty.                                                                                     | nobody (guess taken up front)                                 |
| **Lore Seeker**                                                                      | as drafted                                                | Revealed. You may **add a booster pack**: the Lore Seeker pack is passed first, then you open the new pack, draft from it **as your very next pick**, and pass it the same way. It's drafted this round and lasts a few picks longer than the others.                                                                                | nobody; the round ends later                                  |
| **Cogwork Librarian**                                                                | face up; **each later draft**                             | As you draft a card, you may draft **one more** from that pack (one at a time), and put the Librarian **into that pack**, where it leaves your pool. Several Librarians: several extra cards.                                                                                                                                        | nobody (the pack moves on with the Librarian in it)           |
| **Leovold's Operative**                                                              | face up; **each later draft**, then the **next pack(s)**  | As you draft a card, you may draft one more from that pack. Then turn it face down and **pass the next booster pack you're passed or open without drafting** (you may look). With N Operatives, skip N packs. Skips carry into the next round (ruling: "passed (and/or open)").                                                      | nobody (skipped packs pass straight on)                       |
| **Agent of Acquisitions**                                                            | face up; at **any later pick**                            | **Instead of** drafting one card, draft **every card** in the pack, one at a time, **in an order you choose** (it matters for counts and "next card"). Then turn it face down: you **draft nothing more this round**, and packs reaching you pass straight on (you may look). Only while you're drafting: one per round in practice. | nobody (your packs pass straight on)                          |
| **Cogwork Grinder**                                                                  | face up; **each later draft**                             | As you draft a card, you may **remove it from the draft face down**. It's still "drafted" (it counts, and reveal/face-up instructions happen first), but it isn't in your pool, and nobody else may see it.                                                                                                                          | nobody                                                        |
| **Animus of Predation**                                                              | face up; **each later draft**                             | As you draft a card, you may **remove it from the draft face up** (everyone sees it). Revealed cards' instructions still happen; a "draft face up" card removed this way does nothing.                                                                                                                                               | nobody                                                        |
| **Noble Banneret**                                                                   | face up; **each later creature**                          | As you draft a creature card, you may reveal it, **note its name**, and turn the Banneret face down. Another Banneret can be the creature.                                                                                                                                                                                           | nobody                                                        |
| **Paliano Vanguard**                                                                 | face up; **each later creature**                          | As you draft a creature card, you may reveal it, **note its creature types**, and turn the Vanguard face down.                                                                                                                                                                                                                       | nobody                                                        |
| **Smuggler Captain**                                                                 | face up; **each later draft**                             | As you draft any card, you may reveal it, **note its name**, and turn the Captain face down.                                                                                                                                                                                                                                         | nobody                                                        |
| **Archdemon of Paliano**                                                             | face up, **from your next pick**                          | While face up you **can't look at packs** and **draft at random**. After **three** random cards, turn it face down. Several Archdemons: each random card counts toward all of them. Carries into later rounds. You may look at each card after drafting it and follow its own instructions.                                          | nobody (your picks become instant)                            |
| **Canal Dredger**                                                                    | face up, **for the rest of the draft**                    | Every player passes **the last card of every pack** to a player who drafted a Canal Dredger, instead of to their neighbor. If several players did, the passer chooses which. The Dredger drafts each such card one at a time.                                                                                                        | the passer, briefly (choosing, if there are several Dredgers) |
| **Whispergear Sneak**                                                                | face up; **any time**                                     | Turn it face down to look at **any unopened pack** in the draft, or **any pack nobody is looking at** (one waiting in a queue).                                                                                                                                                                                                      | nobody                                                        |
| **Illusionary Informant**                                                            | face up; **any time**                                     | Turn it face down and choose a player: you see **the next card they draft**. Too late once they've drafted it.                                                                                                                                                                                                                       | nobody                                                        |
| **Deal Broker**                                                                      | face up; **right after the draft**                        | Reveal one card from your pool. Each other player may offer one card (offers revealed together); you may accept one, and the two cards swap pools, notes included. Several Deal Brokers: in random order.                                                                                                                            | **everyone**: decks wait for it                               |
| **Arcane Savant**, **Caller of the Untamed**, **Volatile Chimera**                   | before the game                                           | Exile drafted cards that aren't in your deck. Played at the table.                                                                                                                                                                                                                                                                   | nothing to build                                              |

**What the round boundary does:** it ends Agent of Acquisitions' "no more drafting this round",
and starts new counts for the four "how many cards this round" cards. Everything else keeps
going: face-up cards stay face up (905.2c), and "next card", Leovold's skips and Archdemon's
random picks carry over.

**What the end of the draft does:** face-up cards stop doing anything (905.2c), Deal Broker
exchanges happen, and then pools are final and decks are made.

## 4. Visibility (changes design doc 17, rule 13)

| Who sees         | What                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| everyone         | face-up drafted cards; revealed cards and every noted fact (number, player, colors, name, types); cards removed **face up** (Animus); Spire Phantasm's revealed next card; Deal Broker's revealed card and, once revealed together, the offers |
| one player       | Cogwork Spy's / Illusionary Informant's next card (the Spy's/Informant's drafter); Whispergear Sneak's pack (its drafter)                                                                                                                      |
| nobody else      | cards removed **face down** (Grinder), except by a Cogwork Spy watching that pack                                                                                                                                                              |
| the drafter only | as today: their pack, their face-down pile                                                                                                                                                                                                     |

## 5. How the app emulates "immediately"

A real table settles these things on the spot. The app must not freeze the whole table on one
slow player, so:

- **Choices made while drafting** (Librarian, Leovold's, Agent, Grinder, Animus, Banneret,
  Vanguard, Smuggler, Lore Seeker, the Phantasm's guess, the Dredger destination) are **part of the
  pick**: the pick screen asks, and the pick is submitted with the answers. The timer covers them.
  An auto-pick uses none of the optional abilities.
- **Choices other players must make** (Paliano/Regicide colors) appear **at once** for them, and
  must be answered **before their own next pick**. That's the "immediately" of a real table,
  without stopping anyone else. The order is enforced: right neighbor, then the drafter, then left
  neighbor. If a player's pick timer runs out first, the server chooses for them (a random allowed
  color). Bots choose at once.
- **Any-time actions** (Whispergear Sneak, Illusionary Informant) are buttons available all
  draft long while the card is face up. The Informant must be used before the chosen player's
  next pick is saved.
- **After the draft** (Deal Broker): the draft gets a short **deals** stage before it's finished
  (with a deadline, and the host can end it), then decks are made.

## 6. Model changes (sketch)

- **Card instances:** each drafted card has a stable id and a **location**: in pack N, in seat S's
  pile (face down / face up), removed (face up / face down), or (Librarian) back in a pack. Picks
  record **which cards** a seat drafted in what order, so a pick can draft several.
- **Per seat:** face-up cards, notes (keyed by the card, so they travel with Deal Broker),
  `skipPacks` (Leovold's), `lockedOutThisRound` (Agent), `randomPicksLeft` (Archdemon),
  `nextCardNoted` (Aether Searcher), pending prompts (colors).
- **Per pack:** watchers (Spy, Phantasm with its guess), and added packs (Lore Seeker, queued at
  the **front** of its drafter's queue).
- **Passing:** a pack left with exactly one card goes to a Canal Dredger drafter (the passer
  chooses if there are several), else to the neighbor. Packs reaching a locked-out or skipping
  seat pass straight on.
- **Abilities as data:** a table keyed by card name → ability (the Strategy idea, like
  `DRAFT_STYLES`), so the pick engine asks "what does this card do now?" instead of naming cards.
- **Collections:** picks still reach the collection at once (design doc 17, rule 8). A
  Librarian put back into a pack leaves its drafter's collection in the same transaction. If they
  no longer own it (sold mid-draft), that ability isn't offered. Deal Broker swaps are a trade.
- **Deck building:** Conspiracy-type cards go to the sideboard and don't count toward the 40.

## 7. How a pick works now: steps

A seat's **turn with a pack** can draft several cards, so it's made of **steps**, one card each:

1. **Choose a card** (or "at random" while an Archdemon is face up: the server draws it, and
   the player sees it only after).
2. **Choices about that card**, sent with the step (for a random card: in a second request, once
   it's been seen): remove it (Grinder face down / Animus face up), note it with a face-up
   Banneret, Vanguard or Smuggler Captain, use Librarians or Operatives (one extra card each),
   take the whole pack (Agent, "instead of" the first card), the Phantasm's guess, Lore Seeker's
   added pack, and where a last card goes when there are several Canal Dredger drafters.
3. The turn **continues** while extra cards are owed (Librarian, Operative) or the pack is being
   taken whole (Agent). When it ends: Librarians go into the pack, Operatives and the Agent turn
   face down (skip N packs, or no drafting for the rest of the round), and the pack is passed: to
   a Canal Dredger drafter if one card is left, else to the neighbor.

After every change, packs reaching a seat that must skip, or is locked out for the round, pass
straight on (that seat may look at them), except a last card sent to a Canal Dredger drafter,
which they draft (decision 3). Bots and timed-out players use no optional ability, guess a card
left in the pack, and choose random colors.

**Prompts to other players** (Paliano/Regicide colors) block only the prompted player's next pick,
with their own deadline. **Deal Broker** runs in a `dealing` stage after the last pick: per broker
(in random order), reveal → everyone else offers at once → accept one or none, each step with a
deadline (or ended by the host when the timer is off).

**Reading a draft** uses the aggregate and a pure `visibleTo(draft, seat)` (section 4), so every
rule about who sees what lives in one tested function.

## 8. Decisions (2026-10-02)

1. Cards removed from the draft (Grinder, Animus) **stay in the drafter's collection**; they're
   only out of this draft's pool and deck.
2. Lore Seeker's pack: **an unopened booster from your inventory, or one bought at the store's
   price** on the spot, from **any set** whose booster the app can open. Its basic lands are dealt
   out like the others (design doc 17, rule 15).
3. A Canal Dredger drafter who can't draft (Agent lockout, Leovold's skip) **drafts a last card
   passed to them anyway**.
4. Face-up cards and every noted fact are **public**, as CR 905.2b–c say.
5. **Everything is built**, to emulate a real draft.
