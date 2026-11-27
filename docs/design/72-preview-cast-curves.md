# Design: cast curves in deck previews

- **Phase:** 72
- **Status:** Draft
- **Related ADRs:** 0008 (seeded randomness), 0026 (saved previews)
- **Lesson:** no (reuses the simulator and the preview pipeline; no new TypeScript concept)
- **Module page:** [decks-play.md](../modules/decks-play.md) (the simulator) and
  [decks-building.md](../modules/decks-building.md) (previews); update both when built.
  Builds on [68](68-cast-by-turn.md).

## 1. Purpose & scope

"What does this change do to my commander's mana?" is the question most often asked about a swap,
and a preview today cannot answer it: it reports problems, roles, bracket and price, but not
castability. This adds, to every deck preview, the **before and after cast-by-turn curve** (turns
1 to 10) of the commander and of any card the change adds.

**Out of scope:**

- Saving curves. Nothing is stored; see section 9 for why and when to revisit.
- Any change to the simulator, its run counts or its seeds.
- The scorecard, mana base and builder chart (they keep their own calls).

## 2. Findings that shape the design

1. The simulator is already seeded, pure and fast: one card at 2,000 runs is well under half a
   second (doc 68). A preview is a deliberate, manual action (an LLM tool call or a click), so
   that cost is acceptable. **Previews use the same 2,000 runs as everything else**, not a cut-down
   count. The only rule is that the page must never wait on it: the builder shows the preview
   first and the curves when they arrive (section 8).
2. `castCurves` reads the **saved** deck (`readers.deckView`). A preview is an **unsaved** deck, so
   `castCurves` cannot be called on it as it is. The "after" side needs a variant that takes the
   deck's cards directly. That is the main new code.
3. Comparing before and after fairly needs the **same seed** for both sides, so a difference is
   the change and not shuffle noise. With one seed and 2,000 runs the two decks mostly draw the
   same shuffles up to the point where the swapped card matters.
4. Margin of error is 95% and worst case about +/-2.2 points at 2,000 runs. A difference smaller
   than that is reported as "no clear change", never as a gain or a loss.

## 3. Domain model

```ts
/** One card's curve on both sides of a preview. */
export type CastCurveDelta = Readonly<{
  card: string;
  /** Cumulative percent by turn, index 0 = turn 1, 10 entries. */
  before: readonly number[];
  after: readonly number[];
  /** after - before, per turn, in points. */
  delta: readonly number[];
  /** First turn each side reaches 50%, or null. */
  medianBefore: number | null;
  medianAfter: number | null;
  /** True when no turn's change exceeds the margin of error. */
  withinNoise: boolean;
}>;

export type PreviewCastCurves = Readonly<{
  runs: number;
  marginPct: number;
  onTheDraw: boolean;
  cards: readonly CastCurveDelta[];
}>;
```

`ChangePreview` gains an optional `castCurves: PreviewCastCurves | null`. It is `null` for a deck
below the opening hand size, or when the player asked for no curves.

Which cards: the commander(s) (if the format has a command zone) plus every card the change
**adds** or whose count rises, capped at 5 cards (the commander first, then in change order). A
format without a command zone with no added cards gets `null`.

## 4. Invariants

1. The same deck and seed always give the same `PreviewCastCurves`.
2. A preview with no changes has every `delta` equal to 0 and `withinNoise` true.
3. `before` is the curve the saved deck gives through `castCurves` with the same seed and runs
   (so a preview and a later `draw_sample` agree).
4. A preview never writes: no curve, deck or preview row is stored by this feature.
5. A failing or too-slow simulation never fails the preview: it returns `castCurves: null`.

## 5. Use cases

| Use case                   | Actor / authz | Input                                 | Output                    | Errors (`kind`) | Transaction? |
| -------------------------- | ------------- | ------------------------------------- | ------------------------- | --------------- | ------------ |
| preview changes (existing) | the owner     | `deckId`, changes, `curves?: boolean` | existing preview + curves | existing        | no           |
| apply a saved preview      | the owner     | `previewId`                           | unchanged                 | unchanged       | unchanged    |

`curves` defaults to true for `edit_deck` and the builder; a caller can switch it off. The saved
preview row does **not** store curves (they are recomputed if the preview is shown again), so
the `previews` table is unchanged.

## 6. Ports

`changes` must not import `play` (check the lint rules in `eslint.config.mjs` when building). The
dependency goes through `DeckPreviewDependencies`, like `changePreview` does:

```ts
/** Curves for the before deck and the after deck of a dry run, or null when it can't be made. */
castCurvesForChanges(
  userId: UserId,
  deckId: number,
  changes: readonly DeckChange[],
): Promise<PreviewCastCurves | null>;
```

`decks/wiring.ts` implements it with the play module: a new `castCurvesOf(cards, targets, options)`
in `draw-sample.ts` that takes already-built cards (the body of `castCurves` after it reads the
deck), and `castCurves` is rewritten to call it. No behaviour change for existing callers; the
existing snapshot tests in `engines-pinned.test.ts` pin that.

## 8. Read models

- **`edit_deck` (LLM tool):** the preview text gains a "Cast by turn" block: per card, `T1..T10`
  before, after and delta in points, with "within noise" shown as such. Keep it one short table.
- **Builder:** the preview panel shows the curves **after** the rest of the preview, loaded by its
  own request, so a slow simulation delays only the curves, never the page. A card whose curve is
  `withinNoise` is greyed.

## 9. Persistence

None. Why not store a commander's curve on save (the idea raised before this doc): the curve
depends on the whole deck (lands, ramp, mulligan rule, the effects registry), so every save would
have to recompute it and a registry change would stale every stored row. At well under half a
second per card, the cost is paid only when someone asks. **Revisit** only if a page that must
load quickly needs the commander's curve (the public deck page, for example). If so, store it on
the deck with a fingerprint and recompute on a mismatch, as a separate design.

## 11. Patterns applied

Dependency port through `DeckPreviewDependencies` (patterns.md, ports and adapters), a pure delta
function in `changes/domain` (no I/O, easy to test), and the seeded `Rng` rule (ADR 0008).

## 12. Test plan

- **Domain:** `castCurveDelta` (delta, medians, `withinNoise` at the margin boundary, equal
  curves, a null median on one side).
- **Use case (fakes):** preview with curves; a failing port gives `castCurves: null` and an
  otherwise normal preview; `curves: false` skips the call; no-change preview has zero deltas.
- **Integration:** the before side equals `castCurves` on the saved deck with the same seed;
  swapping a land for a nonland lowers the commander's early-turn curve (a direction check, not
  exact numbers).
- **Snapshot:** the existing `engines-pinned` snapshots must not change.
- **E2E:** the builder shows the preview before the curves; one run in dark mode and at phone
  width.

## 13. Open questions

1. Cap of 5 cards: enough, or should it be the commander plus the three most-changed cards?
2. Seed: a fixed `preview-<deckId>` per deck, so repeated previews of one deck agree, or the
   deck's fingerprint, so any edit reshuffles? (Leaning: `preview-<deckId>`, for stable
   comparisons across edits.)
3. On the draw or on the play: the preview shows the play only; add a toggle later if wanted.
