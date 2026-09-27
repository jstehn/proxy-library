# Lesson 08: Animation, state and sound in the browser

- **Phase:** 8 (opening experience)
- **Prerequisites:** [Lesson 02](02-accounts-and-forms.md) (Server and Client Components),
  [Lesson 06](06-transactions-across-modules.md) (state machines)
- **Time:** 2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Explain why the **server decides** and the browser only **animates**, and what that does and
   doesn't protect.
2. Drive a component with a **pure reducer** (`useReducer`), and test the reducer without React.
3. Use a **discriminated union for UI state** so impossible screens can't be represented.
4. Coordinate time with **`setTimeout`**, **`Promise.all`** and **`Promise.race`**, and test it
   with **fake timers**.
5. Read browser-only state (`localStorage`, `matchMedia`) with **`useSyncExternalStore`**.
6. Build a **3D card flip** and keyframe animations in CSS, and turn them off for
   **"reduce motion"**.
7. Make a sound with the **Web Audio API**: source → filter → volume → speakers.
8. Make an animated screen usable with the **keyboard** and a **screen reader**.

---

# Part A: Who decides what

## A1. The server decides, the browser performs

When you press **Open**, the server generates the pack (lesson 05), saves the cards (lesson 06),
and only then sends you to the page that animates them. The animation is a **performance of a
result that already exists**. No click, timing trick or edited JavaScript can change a pull,
because the browser never gets a say. That's ADR 0008 ("all randomness on the server").

What it **doesn't** protect against is **spoilers**. The card list is in the page's data, so
someone reading the page source could see their rare before flipping it. That's harmless, since the
pull is already final, and it's listed in future-ideas as "spoiler-proof reveals". It's worth
knowing the difference between **integrity** (can't be changed, which matters) and **secrecy**
(can't be seen early, which is nice to have).

## A2. A reducer: the state machine from lesson 06, on the client

The opening has phases: sealed → tearing → revealing → summary → (next pack…) → finished. Rather
than a tangle of `useState` flags (`isTearing`, `isDone`, `revealedCount`…), the whole state is
**one value**, and every change goes through **one pure function**. From
[`machine.ts`](../src/ui/opening/machine.ts):

```ts
export type OpeningState =
  | { phase: "sealed"; pack: number }
  | { phase: "tearing"; pack: number }
  | { phase: "revealing"; pack: number; revealed: number }
  | { phase: "summary"; pack: number }
  | { phase: "finished" };
```

This is a **discriminated union** (lesson 01) used for UI. `revealed` exists **only** while
revealing, and there's no `pack` once finished. A screen that's "sealed but with 3 cards revealed"
can't even be written down. With separate booleans you'd have to remember never to create one.

The reducer takes the current state and an **event**, and returns the next state:

```ts
case "revealing": {
  if (event.type === "revealAll") return { phase: "summary", pack: state.pack };
  if (event.type !== "revealNext") return state; // anything else: ignored
  const revealed = state.revealed + 1;
  return revealed >= cardCount
    ? { phase: "summary", pack: state.pack }
    : { phase: "revealing", pack: state.pack, revealed };
}
```

In Python terms, the whole screen's history is `functools.reduce(reducer, events, initial)`. React's
**`useReducer`** keeps the current value and re-renders when it changes:

```ts
const [state, send] = useReducer(
  (current: OpeningState, event: OpeningEvent) => openingReducer(packs, current, event),
  packs,
  initialState, // called once with `packs` to make the first state
);
// …
<button onClick={() => send({ type: "revealAll" })}>Reveal all</button>
```

Because the reducer is plain TypeScript, [`machine.test.ts`](../src/ui/opening/machine.test.ts)
tests every transition without rendering anything, including the important non-transitions: a
stray `revealNext` while the pack is still sealed must do **nothing**.

---

# Part B: Time

## B1. Waiting for two things, or at most so long

Tearing the pack should take at least 0.9 seconds (so the animation plays), and should also wait
for the card images to load, **but no longer than 3 seconds** (a slow image shouldn't freeze the
screen). From [`pack-opener.tsx`](../src/ui/opening/pack-opener.tsx):

```ts
function waitAtMost(promise: Promise<void>, milliseconds: number): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, milliseconds))]);
}

void Promise.all([minimum, waitAtMost(images, PRELOAD_WAIT_MILLISECONDS)]).then(() =>
  send({ type: "tearFinished" }),
);
```

- **`Promise.all([a, b])`** finishes when **both** have finished (Python: `asyncio.gather`).
- **`Promise.race([a, b])`** finishes when **either** does (Python:
  `asyncio.wait(..., return_when=FIRST_COMPLETED)`, or `asyncio.wait_for` with a timeout).
- **`setTimeout(fn, ms)`** runs `fn` once after `ms` milliseconds (Python: `loop.call_later`).
  Wrapping it in `new Promise(resolve => setTimeout(resolve, ms))` makes an awaitable sleep.
- **`void`** in front says "I'm deliberately not awaiting this": the tear finishes later, on its
  own, and nothing needs to wait for it here.

Preloading is simply creating `new Image()` objects with each card's URL. The browser downloads
and caches them, so when the card flips, its face is already there.

## B2. Suspense is a delay before an event

A rare doesn't flip immediately. The component marks it "in suspense" (shake and glow), waits, then
sends `revealNext` and plays the sting:

```ts
if (level === "none" || reducedMotion) {
  flip();
} else {
  setSuspenseIndex(state.revealed);
  setTimeout(flip, SUSPENSE_MILLISECONDS[level]); // 900 ms for a rare, 1600 for a mythic
}
```

The reducer doesn't know about suspense at all: it's presentation, so it lives in the component.
**Rules about what can happen go in the reducer. Rules about how it looks go in the component.**

## B3. Testing time without waiting

A test for "gives up after 3 seconds" shouldn't take 3 seconds. Vitest's **fake timers** replace
`setTimeout` with a clock you move by hand (the same idea as the `manualClock` from lesson 03):

```ts
vi.useFakeTimers();
const waiting = waitAtMost(new Promise(() => {}), 3000); // a promise that never finishes
await vi.advanceTimersByTimeAsync(2999); // not yet
await vi.advanceTimersByTimeAsync(1); // now it gives up
vi.useRealTimers();
```

Exercise 3 does this in full.

---

# Part C: The browser's own state

## C1. `useSyncExternalStore`

Some state lives **outside React**: whether sound is muted (saved in `localStorage` so it's
remembered), and whether the viewer asked their system for less motion (`matchMedia`). The server
can't see either, since they're in the viewer's browser.

`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` is React's way to read such a
value:

- `subscribe(listener)`: call `listener` whenever the value might have changed, and return a
  function that unsubscribes.
- `getSnapshot()`: read the current value in the browser.
- `getServerSnapshot()`: the value to use while rendering on the server (the default).

From [`sounds.ts`](../src/ui/opening/sounds.ts):

```ts
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion, // listens for the system setting changing
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false, // the server assumes full motion
  );
}
```

The server's HTML and the browser's first render agree (both use the server value), and React
then switches to the real value. That avoids a **hydration** mismatch (lesson 02). `localStorage`
can also throw (private windows block it), so every access is wrapped in `try`/`catch`, with an
in-memory fallback.

## C2. `??=`

One more small operator in `sounds.ts`:

```ts
let context: AudioContext | null = null;
const audio = () => (context ??= new AudioContext());
```

`a ??= b` means "if `a` is null or undefined, set it to `b`", and returns `a`. It creates the
audio context the first time a sound plays and reuses it afterwards (Python:
`if context is None: context = AudioContext()`). Browsers only allow audio after the user has
clicked something, and the first sound always follows a click.

---

# Part D: Making it look and sound right

## D1. A 3D flip in CSS

A card has two faces stacked on top of each other, and the pair rotates together. From
[`globals.css`](../src/app/globals.css):

```css
.flip-card {
  perspective: 1000px;
} /* how far away the viewer is: depth */
.flip-inner {
  transform-style: preserve-3d;
  transition: transform 0.5s ease-out;
}
.flip-inner.is-flipped {
  transform: rotateY(180deg);
}
.flip-face {
  backface-visibility: hidden;
} /* a face turned away is invisible */
.flip-front {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
} /* starts turned away */
```

The front starts rotated 180° (facing away, so hidden). Adding `is-flipped` rotates the pair a
further 180°: the back turns away and the front turns towards you. React only toggles a class name.
The browser animates the rest, smoothly and cheaply.

Other effects are **keyframe animations**, a timeline of property values: `deal` (cards slide in,
staggered with `animationDelay: index × 60ms`), `suspense-shake`, and `foil-shimmer`, a wide
rainbow gradient slid sideways and blended over the art with `mix-blend-mode: color-dodge`.

## D2. "Reduce motion"

Some people get dizzy or unwell from motion on screens, and operating systems have a setting for
it. CSS can check it:

```css
@media (prefers-reduced-motion: reduce) {
  .flip-inner {
    transition: none;
  }
  .animate-deal,
  .animate-suspense,
  .foil-shimmer {
    animation: none;
  }
}
```

The JavaScript checks it too (`useReducedMotion`) to skip the suspense delays. The order of
reveals and the sounds are unchanged, and only the movement goes. The end-to-end test runs with
`page.emulateMedia({ reducedMotion: "reduce" })`, which also makes it fast.

## D3. Sound from nothing: Web Audio

The Web Audio API builds sound from **nodes** wired into a graph, like effects pedals between a
guitar and an amplifier:

```
source (noise or a tone) → filter (shapes the sound) → gain (volume over time) → speakers
```

The "tear" is half a second of random noise through a **band-pass filter** (it lets through only a
range of frequencies) whose center sweeps from 4000 Hz down to 500 Hz, with a volume that jumps up
and fades out. That sweep is what makes it sound like ripping. The rare "sting" is two triangle-wave
notes a ninth of a second apart. Each fades with an **envelope**, a volume curve over time:

```ts
gain.gain.setValueAtTime(0.0001, start);
gain.gain.exponentialRampToValueAtTime(peak, start + 0.01); // quick attack
gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds); // long fade
```

If you've done signal processing in Python (`scipy.signal`), this is the same idea, run live by the
browser.

## D4. Keyboard and screen readers

- **Keyboard:** Space or Enter reveals the next card (and tears the pack). The listener ignores
  keys pressed inside buttons and form fields, so it doesn't clash with them.
- **Screen readers:** a visually hidden `aria-live="polite"` paragraph announces each revealed
  card ("Dawn's Truce, rare, foil"). Face-down cards are labeled "Face-down card 5", and face-up
  cards by their name.
- **Always escapable:** "Reveal all" and "Skip to the end" are ordinary buttons.

---

## Common mistakes

| Mistake                                           | Why it happens              | Instead                                                   |
| ------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| Deciding outcomes in the browser "for smoothness" | it's where the animation is | decide on the server, animate on the client               |
| A handful of boolean `useState` flags             | each new feature adds one   | one union state plus a pure reducer                       |
| Testing a reducer through the UI                  | the UI is where you see it  | test the reducer directly; keep one end-to-end test       |
| Reading `localStorage` during render              | it's synchronous and easy   | `useSyncExternalStore` with a server default              |
| Waiting forever for images                        | "they'll load"              | `Promise.race` with a time limit                          |
| Real timers in tests                              | the code uses `setTimeout`  | fake timers (`vi.useFakeTimers`)                          |
| Animation that can't be turned off                | it looks great to you       | `prefers-reduced-motion`, plus skip buttons               |
| `Math.random` for sound noise                     | noise "should" be random    | the seeded generator: nothing here needs unpredictability |

## Exercises

### 1. Try the settings (warm-up)

Open a pack twice: once normally and once with "reduce motion" on. In Chrome DevTools: ⋮ → More
tools → Rendering → "Emulate CSS media feature prefers-reduced-motion". What changes, and what
stays the same? Then toggle **Sound**, reload, and check it was remembered.

<details><summary>Solution</summary>

With reduced motion, cards appear without flipping, there's no shake or tear, and hits reveal at
once. The order, the glow colors, the sounds and the summary stay the same. Sound's setting
survives a reload because it's in `localStorage` (key `tcg.opening.muted`), which you can see under
DevTools → Application → Local storage.

</details>

### 2. Replay a pack

Add a `replay` event: from a pack's **summary**, it starts that pack's reveal again with every card
face down. In any other phase it does nothing. Write it as a small reducer that handles `replay`
and passes every other event to `openingReducer`, with a test.

<details><summary>Solution</summary>

```ts
function replayingReducer(
  packs: readonly OpenerPack[],
  state: OpeningState,
  event: OpeningEvent | { type: "replay" },
): OpeningState {
  if (event.type === "replay") {
    return state.phase === "summary"
      ? { phase: "revealing", pack: state.pack, revealed: 0 }
      : state;
  }
  return openingReducer(packs, state, event);
}

expect(replayingReducer(packs, { phase: "summary", pack: 0 }, { type: "replay" })).toEqual({
  phase: "revealing",
  pack: 0,
  revealed: 0,
});
expect(replayingReducer(packs, initialState(packs), { type: "replay" })).toBe(initialState(packs)); // unchanged
```

Wrapping one reducer in another is composition (like the fetch wrappers in lesson 04). It doesn't
touch the original, and it's just as testable.

</details>

### 3. Test `waitAtMost` with fake timers

Write a test showing that `waitAtMost(aPromiseThatNeverFinishes, 3000)` hasn't finished after
2999 ms, but has after 3000 ms, without the test taking 3 seconds.

<details><summary>Solution</summary>

```ts
it("gives up after the time limit", async () => {
  vi.useFakeTimers();
  let done = false;
  const waiting = waitAtMost(new Promise<void>(() => {}), 3000).then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(2999);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
  await waiting;
  vi.useRealTimers();
});
```

`advanceTimersByTimeAsync` also lets pending promise callbacks run, which is why `done` flips
straight after. Always switch back to real timers, or later tests will hang.

</details>

### 4. A property: never more face-up cards than the pack has (challenge)

Write a fast-check property: for any list of pack sizes (1–15 cards, 1–4 packs) and any sequence
of up to 80 events, after every event the state's pack index is in range and `revealedCount` never
exceeds that pack's size.

<details><summary>Solution</summary>

```ts
const EVENTS: OpeningEvent["type"][] = [
  "tear",
  "tearFinished",
  "revealNext",
  "revealAll",
  "nextPack",
  "skipToEnd",
];

fc.assert(
  fc.property(
    fc.array(fc.integer({ min: 1, max: 15 }), { minLength: 1, maxLength: 4 }),
    fc.array(fc.constantFrom(...EVENTS), { maxLength: 80 }),
    (sizes, types) => {
      const packs = sizes.map(makePack); // a pack with that many cards
      let state = initialState(packs);
      for (const type of types) {
        state = openingReducer(packs, state, { type } as OpeningEvent);
        if (state.phase !== "finished") {
          expect(state.pack).toBeLessThan(packs.length);
          expect(revealedCount(state, packs[state.pack])).toBeLessThanOrEqual(
            packs[state.pack].cards.length,
          );
        }
      }
    },
  ),
);
```

Random event sequences are exactly the "user mashes every button" case. It's the property-test
version of "stray clicks can't skip ahead".

</details>

### 5. Spoilers (discussion)

Find two places where a player could see their pulls before flipping them. Why doesn't that let
them cheat? What would it take to prevent it?

<details><summary>Solution</summary>

(1) The opener's `packs` prop, serialized into the page for the Client Component. (2) The static
results passed as `children`, which are in the page data too, even while hidden. Neither is
cheating: the cards were saved in `item_openings` before the page loaded, so seeing them early
changes nothing. Preventing it needs the browser to ask for each pack's cards **after** tearing it
(a route handler or server action returning one pack), which means one more round trip per pack.

</details>

## Recap

- **The server decides, the browser performs.** That protects integrity, not secrecy.
- One **union state** plus a **pure reducer** (`useReducer`): impossible screens can't exist, and
  every transition is unit-tested.
- **`Promise.all`** waits for both, **`Promise.race`** for the first, and **`setTimeout`** makes a
  delay. **Fake timers** test them instantly.
- **`useSyncExternalStore`** reads browser-only state safely, with a server default.
- CSS **3D flips** (perspective, preserve-3d, backface-visibility), **keyframes**, and
  **`prefers-reduced-motion`**.
- **Web Audio**: source → filter → gain → speakers, shaped by **envelopes**.
- Keyboard support, `aria-live` announcements, and skip buttons make it usable by everyone.

## Further reading

- [Design doc 08: opening experience](../docs/design/08-opening-experience.md)
- [ADR 0008: injected Rng and Clock](../docs/adr/0008-injected-rng-clock.md)
- React docs: `useReducer`, `useSyncExternalStore`, "Extracting State Logic into a Reducer"
- MDN: "Using CSS transforms" (3D), "@keyframes", "prefers-reduced-motion", `Promise.race`
- MDN: "Web Audio API", "Basic concepts behind Web Audio API"
- Vitest docs: "Fake Timers"
- W3C WAI: "ARIA live regions"
