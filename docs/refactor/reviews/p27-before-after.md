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

- Owned: Elvish Piper, Elvish Warmaster, Genesis Wave, Elvish Clancaller, Farseek, Ranger-Captain of Eos, Prey Upon, Clone Legion, Harmonize, Pulverize
- Store: Naturalize, Nature's Lore, Vigor, Bramble Sovereign, Lightning Greaves, Skyshroud Claim, Primeval Titan, Shaman of the Pack, Llanowar Tribe, Three Visits

### Suggestions per missing role

- ramp (9/10): Bramble Sovereign, Llanowar Tribe, Nature's Lore, Skyshroud Claim, Three Visits
- draw (4/10): Rishkar's Expertise, Harmonize, Skullclamp, Mind Stone, Garruk's Uprising
- removal (5/8): Prey Upon, Naturalize, Acidic Slime
- wipe (0/3): Pulverize

### Cards like one card

- like Llanowar Elves: Bramble Sovereign, Llanowar Tribe, Elvish Clancaller, Wirewood Channeler, Fierce Empath
- like Elvish Visionary: Allosaurus Shepherd, Shaman of the Pack, Elvish Piper, Elvish Warmaster, Elvish Clancaller

### Cuts to consider (first 10, in order)

Craterhoof Behemoth, Sylvan Library, Woodfall Primus, Eternal Witness, Wellwisher, Grizzly Bears, Wirewood Symbiote, Hornet Queen, Regal Force, Rampant Growth

### Swaps to consider (in order)

- Craterhoof Behemoth -> Elvish Piper
- Eternal Witness -> Genesis Wave
- Grizzly Bears -> Farseek
- Wirewood Symbiote -> Ranger-Captain of Eos
- Sylvan Library -> Elvish Warmaster

### Budget list ($15, store cards)

Naturalize, Bramble Sovereign, Shaman of the Pack, Llanowar Tribe, Mind Stone, Allosaurus Shepherd

### Draft-a-deck picks (in order; owned = o, store = s)

Beast Whisperer (o, role), Elvish Visionary (o, role), Regal Force (o, role), Beast Within (o, role), Rishkar's Expertise (o, role), Terastodon (o, role), Harmonize (o, role), Acidic Slime (o, role), Arcane Signet (o, role), Return to Nature (o, role), Cultivate (o, role), Prey Upon (o, role), Farseek (o, role), Pulverize (o, role), Garruk's Uprising (s, role), Mind Stone (s, role), Skullclamp (s, role), Naturalize (s, role), Reclamation Sage (s, role), Bramble Sovereign (s, role), Woodfall Primus (s, role), Elvish Clancaller (o, plan), Elvish Piper (o, plan), Genesis Wave (o, plan), Avenger of Zendikar (o, plan), Ranger-Captain of Eos (o, plan), Imperious Perfect (o, plan), Elvish Warmaster (o, plan), Clone Legion (o, plan), Fierce Empath (o, plan)

## Graveyard (black-green-blue, commander Muldrotha, target bracket 3)

Profile: themes graveyard, sacrifice, spells, artifacts; tribes none; short of ramp, draw, removal, wipe.

### Suggestions for the deck

- Owned: Necropotence, Bloodghast, Gaea's Blessing, Scavenging Ooze, Toxic Deluge, Life from the Loam, Beast Within, Lotus Cobra, Blightsteel Colossus, Treasure Cruise
- Store: Entomb, Spider Spawning, Tasigur, the Golden Fang, Frantic Search, Vampiric Tutor, Pestilence, Dread Return, Reanimate, Animate Dead, Memory Lapse

### Suggestions per missing role

- ramp (6/10): Farseek, Rampant Growth
- draw (5/10): Gaea's Blessing, Harmonize, Treasure Cruise, Frantic Search, Sylvan Library
- removal (4/8): Beast Within, Ravenous Chupacabra, Shriekmaw
- wipe (1/3): Toxic Deluge, Pestilence

### Cards like one card

- like Sakura-Tribe Elder: Pernicious Deed, Lotus Cobra, Dread Return, Farseek, Rampant Growth
- like Mind Stone: Sylvan Library, Pernicious Deed, Mystic Remora, Dread Return, Gaea's Blessing

### Cuts to consider (first 10, in order)

Craterhoof Behemoth, Rhystic Study, Hornet Queen, Cyclonic Rift, Mulldrifter, Spore Frog, Reclamation Sage, Grizzly Bears, Counterspell, Viscera Seer

### Swaps to consider (in order)

- Rhystic Study -> Gaea's Blessing
- Grizzly Bears -> Life from the Loam
- Mulldrifter -> Treasure Cruise
- Craterhoof Behemoth -> Necropotence
- Reclamation Sage -> Toxic Deluge

### Budget list ($15, store cards)

Spider Spawning, Tasigur, the Golden Fang, Frantic Search, Dread Return, Memory Lapse, Rampant Growth

### Draft-a-deck picks (in order; owned = o, store = s)

Gaea's Blessing (o, role), Mystic Remora (o, role), Terastodon (o, role), Harmonize (o, role), Cyclonic Rift (o, role), Treasure Cruise (o, role), Beast Within (o, role), Go for the Throat (o, role), Farseek (o, role), Shriekmaw (o, role), Toxic Deluge (o, role), Frantic Search (s, role), Mulldrifter (s, role), Rampant Growth (s, role), Phyrexian Arena (s, role), Reclamation Sage (s, role), Skullclamp (s, role), Ravenous Chupacabra (s, role), Damnation (s, role), Sylvan Library (s, role), Pestilence (s, role), Satyr Wayfinder (o, plan), Murderous Rider (o, plan), Scavenging Ooze (o, plan), Living Death (o, plan), Blightsteel Colossus (o, plan), Bridge from Below (o, plan), Mystic Snake (o, plan), Life from the Loam (o, plan), Necropotence (o, plan)
