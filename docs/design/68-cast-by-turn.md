# 68. "Can I cast X by turn Y?": the cast simulator

Status: built (P28). Lesson: no.

## The question

What is the probability that I can cast card X (or any of these cards) by turn Y, on the play or on
the draw? It is estimated by bootstrapping: shuffle the deck N times (seeded), deal the opening hand
by the deck's mulligan rule, then play each turn (draw, one land, ramp and cost reducers cast ahead)
and record **the first turn X could be cast**. One set of runs gives the whole curve, so a "by turn Y"
question reads one row.

A commander is in the command zone, so for it only the mana matters (`mustDraw: false`). The
commander tax is not modelled.

## The answer

`castCurves` (the `draw_sample` capability) returns, per card: the cumulative percent chance for
turn 1 to `lastTurn` (default 10), the median turn (first turn at 50%, or null), and the commonest
reasons a run failed ("not drawn 12%, too little mana 20%, no B source 9%"). The report has the run
count and a margin of error (95%, worst case: 2,000 runs is +/-2.2 points). The tool prints it as a
header and one `T<n>` line per turn, a column per card. A measurement, never a score.

## The simulator

`decks/domain/cast-by-turn.ts`, built on `playOpening` (one hand engine) and `canPay` (one payment
engine). The same function answers the scorecard's "castable on curve" per spell (mana only, no
mulligan, the card need not be drawn) and the tool and the builder's chart.

- A land is chosen for the target: the one adding a colour it still lacks, then one that enters
  untapped. A land with a condition ("unless you control a land") enters tapped only as the first
  land; a land that needs five lands makes nothing before the fifth.
- Ramp and cost reducers in hand are cast with spare mana, cheapest first; they work from the next
  turn. Rituals in hand are tried on the turn the target is checked.
- Declared cost reducers (the deck plan, Henzie style) are counted in the target's mana value
  (`effectiveManaValue`); the registry's reducers apply once the card is in play.

## The registry

`decks/domain/cast-effects.ts`: `CAST_EFFECTS`, one handler per kind, four kinds only.

| kind        | does                                                 | example            |
| ----------- | ---------------------------------------------------- | ------------------ |
| `ritual`    | cast from hand: pay a cost, add mana                 | Dark Ritual        |
| `reducer`   | in play: spells of some types cost generic mana less | Foundry Inspector  |
| `tapMana`   | in play: taps for mana (from the card features)      | Sol Ring, Llanowar |
| `landFetch` | cast: a land joins the battlefield (card features)   | Rampant Growth     |

A card gets an effect from `CARD_EFFECTS` (by name) or from the catalog's `tapMana` feature; a card
with none is not affected. More names are one line each.

## Runs and time

Server-side, seeded (`seededRng`), no clock in the loop. A run count is the time budget:
`draw_sample` takes 100 to 5,000 `trials` (default 2,000); the scorecard and mana base use 400 to
500 and cap at 2,000. One card at 2,000 runs takes well under half a second, so nothing runs in the
worker. The builder's chart asks for 2,000 runs of one card.
