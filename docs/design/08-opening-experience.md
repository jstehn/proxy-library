# Design: Opening experience

- **Phase:** 8
- **Status:** **Approved** (self-approved during the unattended run, 2026-09-27; see
  [decisions-to-review.md](../decisions-to-review.md))
- **Related ADRs:** 0008 (all randomness on the server; the client only animates)

## 1. Purpose & scope

Make opening a pack **feel** like opening a pack. You tear it open, the cards are dealt face down,
and you flip them one at a time in the suspense order from Phase 5 (rares last). Rares and mythics
get a build-up and a glow, foils shimmer, and it all has sound. After the last card, a summary shows
what the pack was worth.

The pack's contents are **decided on the server before the animation starts** (Phase 6 already
saved them). The animation only reveals them: nothing the browser does can change a pull.

**Out of scope:** animations for boxes and decks (they unpack into packs, which animate), and
special effects per foil treatment (galaxy, surge…), which are in future-ideas.

## 2. Vocabulary

| Term         | Meaning                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| **Opener**   | The client component that plays a sequence of packs: tear, deal, reveal, summary.            |
| **Reveal**   | Flipping the next face-down card, always in the pack's stored reveal order.                  |
| **Suspense** | The build-up before a notable card flips: a pause, a shake and a glow in its rarity's color. |
| **Hit**      | A card worth making a fuss about: rare or better, or any card worth at least $5.             |

## 3. The client state machine

A pure reducer, `openingReducer(state, event)`, in `src/ui/opening/machine.ts`. It's plain
TypeScript, with no React inside, so it's unit-tested like the domain code.

```ts
type OpeningState =
  | { phase: "sealed"; pack: number } // pack art, "Tear it open"
  | { phase: "tearing"; pack: number } // tear animation playing
  | { phase: "revealing"; pack: number; revealed: number } // `revealed` cards face up so far
  | { phase: "summary"; pack: number } // this pack's summary
  | { phase: "finished" }; // every pack done

type OpeningEvent =
  | { type: "tear" }
  | { type: "tearFinished" }
  | { type: "revealNext" }
  | { type: "revealAll" }
  | { type: "nextPack" }
  | { type: "skipToEnd" };
```

| From          | Event        | To                                                  |
| ------------- | ------------ | --------------------------------------------------- |
| sealed        | tear         | tearing                                             |
| tearing       | tearFinished | revealing (0 revealed)                              |
| revealing     | revealNext   | revealing (+1), or summary after the last card      |
| revealing     | revealAll    | summary                                             |
| summary       | nextPack     | sealed (next pack), or finished after the last pack |
| any           | skipToEnd    | finished                                            |
| anything else | —            | unchanged (a stray click or key press does nothing) |

## 4. Rules

1. **Reveal order is the server's order.** The client never sorts or shuffles.
2. **Nothing random happens in the browser.** Sounds and effects depend only on the card: its
   rarity, finish and price.
3. **Suspense only for hits**, so it stays special: rare (gold glow), mythic (orange glow, longer
   pause), any card ≥ $5 (the same as mythic). Foils add the shimmer on top.
4. **Always skippable:** "Reveal all", "Skip to the end", and the keyboard (Space or Enter reveals
   the next card).
5. **Respects "reduce motion":** with the system setting on, cards appear without flips or shakes,
   and the order and sounds stay the same.
6. **Sound is optional and generated.** Tear, flip and hit stings are made with the Web Audio API,
   with no sound files. A mute toggle is remembered in the browser (`localStorage`, with
   `try`/`catch`). Sound starts only after the first click, as browsers require.
7. **Images load before the tear:** every card image in the sequence is preloaded while the
   sealed pack is showing. The tear waits up to 3 seconds for them, then goes ahead anyway.

## 5. Where it appears

- The **Open** and **Open all** buttons send you to `/inventory/opened?items=…&animate=1`. With
  `animate=1`, the page plays every **pack** among the openings in the opener, then shows the static
  results (boxes, decks and the full card grid) as before.
- "Recently opened" links don't include `animate=1`, so they show the static results straight
  away.

## 6. Components

- `src/ui/opening/machine.ts`: the reducer, plus `hitLevel(card)` (none, rare, mythic).
- `src/ui/opening/sounds.ts`: `makeSounds()` builds the Web Audio sounds (tear: a burst of noise
  sweeping down; flip: a short click; rare: a rising two-note chime; mythic: a three-note chord),
  and `useMuted()` remembers the toggle.
- `src/ui/opening/pack-opener.tsx`: the client component (packs in, animation out).
- `src/ui/opening/card-back.tsx`: a generated card back (our own design, not the real one).
- CSS keyframes in `globals.css`: `tear`, `deal`, `flip`, `shake`, `glow`, `foil-shimmer`.

## 7. Persistence and ports

None. The opener only reads what the page gives it.

## 8. Patterns applied

- **State machine (13)** for the client sequence, as a pure reducer (`useReducer`).
- **Functional core** on the client: the reducer and `hitLevel` are pure and unit-tested. The
  component only renders state and sends events.

## 9. Test plan

- **Unit:** the reducer's transition table (including ignored events), `hitLevel`, and the order
  of revealed cards.
- **End-to-end:** buy and open a pack, tear, reveal one card, "Reveal all", see the summary's
  value, "Done", and see the static results. It runs with reduced motion so it's fast, which also
  tests rule 5.
- **Manual:** screenshots mid-animation, and a listen to the sounds.

## 10. Decisions made without review

1. **CSS animations and `useReducer`, no animation library** (the original plan named Motion):
   flips, tears and shimmers are simple keyframes, and it's one dependency fewer.
2. **The card back is our own design** (a dark swirl with the app's name), not the real Magic card
   back, which is Wizards of the Coast's artwork.
3. **"Hit" includes any card worth $5 or more**, so an expensive uncommon gets its moment too.
