# decks: play (test hands, odds, "can I cast X by turn Y?")

Simulating a deck: the builder's test hand, exact opening-hand odds, the Monte Carlo opening-hand
report, and the cast simulator behind `draw_sample` and the scorecard. Code:
`src/modules/decks/play/` (ADR 0029). Checked against `refactor/main` (2026-11-20).

**Not here any more.** The interactive goldfish (doc 60's goldfish tools, `goldfish_start` and
`goldfish_step`, its stored sessions and its invariants 1-7) was removed in P24 on the owner's
answer D3. The mulligan trainer and scorecard drills (doc 59) went with it. The server-side
simulations that answer "can I cast X by turn Y?" stay (owner D3). The orphaned table
`goldfish_sessions` waits for the owner's call on a migration (removal list).

## One hand engine

1. **The library holds one entry per main-deck copy**, never a commander (in the command zone) or a
   sideboard or maybeboard card. (doc 19 §4 rule 5, doc 43 §4 rule 4; `draws.test.ts`)
2. **A hand after `k` mulligans keeps `7 - k` cards** (London mulligan: draw 7, bottom one per
   mulligan; one fewer in Commander, where the first mulligan is free, on by default with a switch).
   A bottomed card goes to the bottom of the library. At most two mulligans in a simulation; the last
   hand is kept when they run out. (doc 19 §4 rule 6, §13.5; `draws.test.ts`, `hand.test.ts`)
3. **One keep rule:** 2 to 4 lands with a spell castable by turn 3 (`COMMANDER_KEEP`); with too many
   lands the land is bottomed, otherwise the dearest spell. (doc 56; `hand.test.ts`)
4. **All randomness is an injected `Rng`.** The same seed gives the same hands and the same numbers;
   `Math.random` is never called; the browser's test hand takes a seed from the server. (ADR 0008,
   doc 19 §4 rule 9, doc 56 §3 rule 1; `hand.test.ts`, `engines-pinned.test.ts`)
5. **One mana-payment engine** (`mana-payment.ts` in `core`): hybrid pips pay with either colour,
   `{C}` needs a colourless source, pips are matched to sources exactly, half-mana symbols are not
   colour pips. (P15 handoff, accepted by the owner 2026-11-20; `mana-payment.test.ts`)

## Exact odds

6. **Probabilities are exact (hypergeometric)** and lie in [0, 1]; `hypergeometricAtLeast` is 1 when
   nothing is needed and 0 when impossible; the exact counts sum to 1; it matches a seeded
   20,000-hand simulation within 1.5 points; more draws never lower it. (doc 19 §4 rule 7, doc 43
   §4 rules 2-3; `draws.test.ts`)
7. **Opening-hand odds** split the library into too few, playable and too many lands, which sum to
   1; going on the draw is at least as good for every draw-dependent number; early ramp means mana
   value 3 or less, and a card with no mana value is not early ramp; land drops are tracked for
   turns 1-5. (doc 43 §4 rules 1-2; `draws.test.ts`)

## Cast simulator

8. **One simulator, `simulateCasting`**, built on the hand engine and the payment engine, answers
   "can I cast X by turn Y?" for the `draw_sample` tool, the scorecard's "castable on curve" and the
   builder's cast chart. One set of runs gives the whole curve, so "by turn Y" reads one row.
   (doc 68; `cast-by-turn.test.ts`)
9. **Its curve for a fixed seed is repeatable and never falls,** and the "drawn by turn Y" curve
   matches the exact hypergeometric chance within 3 points. It also names the commonest reason a run
   missed (not drawn, too little mana, no source of a colour). (doc 68 §The answer; `cast-by-turn.test.ts`)
10. **A commander is in the command zone,** so only mana matters for it; commander tax is not
    modelled. (doc 68)
11. **Effects come from a small registry** (`cast-effects.ts`): `ritual` (Dark Ritual), `reducer`
    (Foundry Inspector), `tapMana` (from the card features) and `landFetch` (Rampant Growth,
    Cultivate). A card gets an effect by name or by feature; a card with none is unaffected. Lands that
    enter tapped (conditional ones only as the first land) and a ritual that cannot be paid without its
    colour are modelled. More effects are one registry line each. (doc 68 §The registry, P28/P28b
    handoffs; `cast-by-turn.test.ts`)
12. **Run counts bound the time:** `draw_sample` takes 100-5,000 `trials` (default 2,000, about
    +/-2 points), `lastTurn` 1-10, and `cast` names or "commander". The output is a measurement
    with a margin of error, never a score. (doc 68 §Runs and time, owner D1; `draw-sample.ts`)
13. **Castability before and after.** The mana-base plan and the scorecard report castability with
    the same simulator; the same seed gives bit-identical percentages, and replacing off-colour lands
    with untapped coloured sources raises it. (doc 58 §4 rule 4 and §7.2; `castability.test.ts`)

## Open decisions (found while writing this page)

- Doc 61 §4 rules 1-3 and §10 (strict goldfish casts, blitz lifecycle) describe the removed goldfish;
  they are dropped here, not decided.
- `FormatRuleSet.commandZoneTaxPerCast` was read only by the deleted goldfish; the removal list
  says P28 keeps it only if the effect registry reads it. Nothing in production reads it now (only its own test), so it is a dead field unless a feature needs it.
