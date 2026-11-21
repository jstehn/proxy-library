# P27: what the suggestions, cuts and swaps said before and after

The owner asked to look at this ([owner-answers.md](plan-review/owner-answers.md), D1). P27 puts one
scorer (`rateCard`, one fitted weight table) behind suggestions, cuts, "cards like this one" and
draft-a-deck, so these lists may reorder. **No scores here, only card names in the order the
screens show them.**

How the lists were made: two reference decks of real cards (an Elf deck and a graveyard deck, each
with a commander, about 30 spells and lands) and a pool of about 35 other real cards for each.
EDHREC percentages, ranks, precon counts, text similarity, "owned or for sale" and "do you own this
copy" are made-up numbers seeded from the card's name, so the same lists come out on every run. The
pure domain code ran, with no database. The cards' roles, themes and signals were read from their
rules text by the same recognizers the app uses. Judge the order, not the details: the pool is
small, and the numbers are invented.

# BEFORE (refactor/main at 17d3d86)

## Elves (mono-green, commander Ezuri, target bracket 2)

Profile: themes spells, tokens, creature-tokens; tribes Elf; short of ramp, draw, removal, wipe.

### Suggestions for the deck

- Owned: Elvish Warmaster, Elvish Piper, Elvish Clancaller, Prey Upon, Genesis Wave, Fierce Empath, Clone Legion, Ranger-Captain of Eos, Pulverize, Farseek
- Store: Bramble Sovereign, Llanowar Tribe, Shaman of the Pack, Naturalize, Allosaurus Shepherd, Dwynen, Gilt-Leaf Daen, Wirewood Channeler, Vigor, Nettle Sentinel, Skyshroud Claim

### Suggestions per missing role

- ramp (9/10): Bramble Sovereign, Llanowar Tribe, Nature's Lore, Skyshroud Claim, Three Visits
- draw (4/10): Rishkar's Expertise, Harmonize, Skullclamp, Mind Stone, Garruk's Uprising
- removal (5/8): Prey Upon, Naturalize, Acidic Slime
- wipe (0/3): Pulverize

### Cards like one card

- like Llanowar Elves: Bramble Sovereign, Llanowar Tribe, Elvish Clancaller, Wirewood Channeler, Fierce Empath
- like Elvish Visionary: Allosaurus Shepherd, Shaman of the Pack, Elvish Piper, Elvish Warmaster, Elvish Clancaller

### Cuts to consider (first 10, in order)

Craterhoof Behemoth, Sylvan Library, Grizzly Bears, Wirewood Symbiote, Eternal Witness, Woodfall Primus, Regal Force, Giant Growth, Verdant Force, Wellwisher

### Swaps to consider (in order)

- Craterhoof Behemoth -> Elvish Warmaster
- Grizzly Bears -> Elvish Clancaller
- Sylvan Library -> Elvish Piper
- Wirewood Symbiote -> Prey Upon
- Woodfall Primus -> Fierce Empath

### Budget list ($15, store cards)

Bramble Sovereign, Llanowar Tribe, Shaman of the Pack, Naturalize, Allosaurus Shepherd, Dwynen, Gilt-Leaf Daen

### Draft-a-deck picks (in order; owned = o, store = s)

Beast Whisperer (o, role), Elvish Visionary (o, role), Regal Force (o, role), Beast Within (o, role), Rishkar's Expertise (o, role), Terastodon (o, role), Harmonize (o, role), Acidic Slime (o, role), Arcane Signet (o, role), Return to Nature (o, role), Cultivate (o, role), Prey Upon (o, role), Farseek (o, role), Pulverize (o, role), Garruk's Uprising (s, role), Mind Stone (s, role), Skullclamp (s, role), Naturalize (s, role), Reclamation Sage (s, role), Bramble Sovereign (s, role), Woodfall Primus (s, role), Elvish Clancaller (o, plan), Elvish Piper (o, plan), Imperious Perfect (o, plan), Fierce Empath (o, plan), Elvish Warmaster (o, plan), Avenger of Zendikar (o, plan), Genesis Wave (o, plan), Clone Legion (o, plan), Ranger-Captain of Eos (o, plan)

## Graveyard (black-green-blue, commander Muldrotha, target bracket 3)

Profile: themes graveyard, sacrifice, spells, artifacts; tribes none; short of ramp, draw, removal, wipe.

### Suggestions for the deck

- Owned: Necropotence, Bloodghast, Blightsteel Colossus, Gaea's Blessing, Scavenging Ooze, Life from the Loam, Splinterfright, Bridge from Below, Treasure Cruise, Lotus Cobra
- Store: Entomb, Tasigur, the Golden Fang, Spider Spawning, Dread Return, Reanimate, Frantic Search, Memory Lapse, Animate Dead, Vampiric Tutor, Pestilence

### Suggestions per missing role

- ramp (6/10): Farseek, Rampant Growth
- draw (5/10): Gaea's Blessing, Harmonize, Treasure Cruise, Frantic Search, Sylvan Library
- removal (4/8): Beast Within, Ravenous Chupacabra, Shriekmaw
- wipe (1/3): Toxic Deluge, Pestilence

### Cards like one card

- like Sakura-Tribe Elder: Pernicious Deed, Lotus Cobra, Dread Return, Farseek, Rampant Growth
- like Mind Stone: Sylvan Library, Pernicious Deed, Mystic Remora, Dread Return, Gaea's Blessing

### Cuts to consider (first 10, in order)

Craterhoof Behemoth, Grizzly Bears, Rhystic Study, Mystic Snake, Hornet Queen, Mulldrifter, Cyclonic Rift, Carrion Feeder, Viscera Seer, Reclamation Sage

### Swaps to consider (in order)

- Mulldrifter -> Life from the Loam
- Craterhoof Behemoth -> Necropotence
- Grizzly Bears -> Bloodghast
- Rhystic Study -> Gaea's Blessing
- Mystic Snake -> Blightsteel Colossus

### Budget list ($15, store cards)

Tasigur, the Golden Fang, Spider Spawning, Dread Return, Frantic Search, Memory Lapse, Rampant Growth

### Draft-a-deck picks (in order; owned = o, store = s)

Gaea's Blessing (o, role), Mystic Remora (o, role), Terastodon (o, role), Harmonize (o, role), Cyclonic Rift (o, role), Treasure Cruise (o, role), Beast Within (o, role), Go for the Throat (o, role), Farseek (o, role), Shriekmaw (o, role), Toxic Deluge (o, role), Frantic Search (s, role), Mulldrifter (s, role), Rampant Growth (s, role), Phyrexian Arena (s, role), Reclamation Sage (s, role), Skullclamp (s, role), Ravenous Chupacabra (s, role), Damnation (s, role), Sylvan Library (s, role), Pestilence (s, role), Living Death (o, plan), Blightsteel Colossus (o, plan), Satyr Wayfinder (o, plan), Scavenging Ooze (o, plan), Necropotence (o, plan), Bridge from Below (o, plan), Eternal Witness (o, plan), Bloodghast (o, plan), Life from the Loam (o, plan)

# AFTER (P27)

## Elves (mono-green, commander Ezuri, target bracket 2)

Profile: themes spells, tokens, creature-tokens; tribes Elf; short of ramp, draw, removal, wipe.

### Suggestions for the deck

- Owned: Elvish Warmaster, Elvish Piper, Elvish Clancaller, Prey Upon, Genesis Wave, Fierce Empath, Clone Legion, Ranger-Captain of Eos, Pulverize, Farseek
- Store: Bramble Sovereign, Llanowar Tribe, Shaman of the Pack, Naturalize, Allosaurus Shepherd, Dwynen, Gilt-Leaf Daen, Wirewood Channeler, Vigor, Nettle Sentinel, Skyshroud Claim

### Suggestions per missing role

- ramp (9/10): Bramble Sovereign, Llanowar Tribe, Skyshroud Claim, Nature's Lore, Farseek
- draw (4/10): Mind Stone, Harmonize, Garruk's Uprising, Skullclamp, Rishkar's Expertise
- removal (5/8): Naturalize, Prey Upon, Acidic Slime
- wipe (0/3): Pulverize

### Cards like one card

- like Llanowar Elves: Bramble Sovereign, Llanowar Tribe, Elvish Clancaller, Fierce Empath, Wirewood Channeler
- like Elvish Visionary: Allosaurus Shepherd, Elvish Piper, Shaman of the Pack, Bramble Sovereign, Elvish Clancaller

### Cuts to consider (first 10, in order)

Grizzly Bears, Sylvan Library, Craterhoof Behemoth, Woodfall Primus, Giant Growth, Eternal Witness, Rampant Growth, Hornet Queen, Terastodon, Kodama's Reach

### Swaps to consider (in order)

- Craterhoof Behemoth -> Elvish Clancaller
- Grizzly Bears -> Elvish Warmaster
- Sylvan Library -> Elvish Piper
- Woodfall Primus -> Prey Upon
- Eternal Witness -> Fierce Empath

### Budget list ($15, store cards)

Bramble Sovereign, Llanowar Tribe, Shaman of the Pack, Naturalize, Allosaurus Shepherd, Dwynen, Gilt-Leaf Daen

### Draft-a-deck picks (in order; owned = o, store = s)

Beast Whisperer (o, role), Elvish Visionary (o, role), Regal Force (o, role), Prey Upon (o, role), Harmonize (o, role), Return to Nature (o, role), Rishkar's Expertise (o, role), Beast Within (o, role), Cultivate (o, role), Acidic Slime (o, role), Arcane Signet (o, role), Terastodon (o, role), Farseek (o, role), Pulverize (o, role), Garruk's Uprising (s, role), Mind Stone (s, role), Skullclamp (s, role), Naturalize (s, role), Reclamation Sage (s, role), Bramble Sovereign (s, role), Woodfall Primus (s, role), Elvish Clancaller (o, plan), Elvish Piper (o, plan), Imperious Perfect (o, plan), Fierce Empath (o, plan), Elvish Warmaster (o, plan), Avenger of Zendikar (o, plan), Genesis Wave (o, plan), Clone Legion (o, plan), Ranger-Captain of Eos (o, plan)

## Graveyard (black-green-blue, commander Muldrotha, target bracket 3)

Profile: themes graveyard, sacrifice, spells, artifacts; tribes none; short of ramp, draw, removal, wipe.

### Suggestions for the deck

- Owned: Necropotence, Bloodghast, Blightsteel Colossus, Gaea's Blessing, Scavenging Ooze, Life from the Loam, Splinterfright, Bridge from Below, Treasure Cruise, Lotus Cobra
- Store: Entomb, Tasigur, the Golden Fang, Spider Spawning, Dread Return, Reanimate, Frantic Search, Memory Lapse, Animate Dead, Vampiric Tutor, Pestilence

### Suggestions per missing role

- ramp (6/10): Farseek, Rampant Growth
- draw (5/10): Gaea's Blessing, Frantic Search, Treasure Cruise, Harmonize, Sylvan Library
- removal (4/8): Beast Within, Ravenous Chupacabra, Shriekmaw
- wipe (1/3): Toxic Deluge, Pestilence

### Cards like one card

- like Sakura-Tribe Elder: Dread Return, Pestilence, Lotus Cobra, Farseek, Rampant Growth
- like Mind Stone: Gaea's Blessing, Blightsteel Colossus, Dread Return, Pestilence, Sylvan Library

### Cuts to consider (first 10, in order)

Grizzly Bears, Cyclonic Rift, Mulldrifter, Hornet Queen, Craterhoof Behemoth, Rhystic Study, Reclamation Sage, Spore Frog, Sakura-Tribe Elder, Giant Growth

### Swaps to consider (in order)

- Mulldrifter -> Gaea's Blessing
- Grizzly Bears -> Necropotence
- Craterhoof Behemoth -> Scavenging Ooze
- Rhystic Study -> Life from the Loam
- Hornet Queen -> Blightsteel Colossus

### Budget list ($15, store cards)

Tasigur, the Golden Fang, Spider Spawning, Dread Return, Frantic Search, Memory Lapse, Rampant Growth

### Draft-a-deck picks (in order; owned = o, store = s)

Gaea's Blessing (o, role), Mystic Remora (o, role), Terastodon (o, role), Treasure Cruise (o, role), Go for the Throat (o, role), Harmonize (o, role), Beast Within (o, role), Cyclonic Rift (o, role), Farseek (o, role), Shriekmaw (o, role), Toxic Deluge (o, role), Frantic Search (s, role), Mulldrifter (s, role), Rampant Growth (s, role), Phyrexian Arena (s, role), Reclamation Sage (s, role), Skullclamp (s, role), Ravenous Chupacabra (s, role), Damnation (s, role), Sylvan Library (s, role), Pestilence (s, role), Necropotence (o, plan), Satyr Wayfinder (o, plan), Scavenging Ooze (o, plan), Living Death (o, plan), Bloodghast (o, plan), Blightsteel Colossus (o, plan), Eternal Witness (o, plan), Bridge from Below (o, plan), Life from the Loam (o, plan)

# What moved, and why

How much changed, in three lines:

- **Suggestions for the deck** (the first list): no change at all. They were already ordered by
  `rateCard`; only the old point tables decided which cards were left out.
- **Role lists and "cards like this one":** the same cards in most lists, with one or two moved or
  swapped. **Cuts:** 3 or 4 of the first 10 differ, and the order moves. **Swaps:** 2 or 3 of the
  5 pairs differ. **Draft-a-deck:** the first 30 picks hold nearly the same cards, in a slightly
  different order.
- **Budget list:** no change in either deck.

The deliberate differences, for you to judge:

1. **Cuts.** A card helps the deck by what `rateCard` says: themes, tribe, EDHREC, quality, the
   curve. The old cut table gave +3 to any card whose role the deck needed. The fitted weight for
   "the deck is short of this role" is small (the data says role slots are filled in real decks),
   so ramp spells such as Rampant Growth and Kodama's Reach can now show up as possible cuts
   even when the deck is short of ramp. The "cutting it would leave a gap" reason still shows.
   Cards you don't own used to count for -1 point; now they only come first when two cards tie.
   Vanilla filler (Grizzly Bears, Giant Growth) now leads the cut list in both decks.
2. **Cards like this one.** They are rated against a deck made of just that card (its themes, tribe,
   keywords and roles), by the same table. Same type and similar cost no longer add points. When
   text embeddings exist, a nearest neighbour with text similarity under 0.55 is no longer listed.
3. **Role lists** rate each card with only that role's gap in the deck, so a card that does two
   jobs doesn't top every list. They now also use the bracket and the card's EDHREC data.
4. **Draft-a-deck.** Same steps. The order inside a step comes from the rating. Among store cards
   the card with more reasons comes first, then the cheaper one. The profile the draft keeps up to
   date now also holds the deck's synergy signals and curve, so synergy and the curve penalty count.
5. **Optimizer.** The rating of a card it cuts now includes that card's EDHREC data (it left it
   out before), so "net rating gain" is fairer.
6. **The swap panel in the builder** now passes the Game Changer flag of each candidate, so the
   "no Game Changers at bracket 2 or lower" filter works there too.

Not changed: the weights. `RATING_WEIGHTS` and its tier overrides are the same numbers as before,
now documented, marked as fitted from data, and tied to `scripts/dev/fit-rating-weights.ts`.
