# Design: Dry-run deck changes (`apply_changes`) and Partner/Background commander pairs

- **Phase:** 40 (tududi tasks `#44` and `#74`, project "Build decks from owned cards")
- **Status:** **Approved** (2026-11-11), with D1 = include the Edit as text preview
- **Related:** design doc 09 (deck rules), design doc 19 (role tags & targets), design doc 23 (Edit as text, fingerprints), design doc 28 (LLM tool API), design doc 31 (Commander brackets), design doc 37 (`draft_deck`). No new ADR: the preview is a pure function in `src/modules/decks/domain/`, and saving reuses the unit of work and fingerprint check that `replace_deck_list` already uses.
- **Lesson:** no.

## 1. Purpose & scope

Two gaps make an agent (and a player) edit decks blind:

1. **No preview (`#44`).** `set_deck_entry` and `replace_deck_list` save immediately. To learn whether a set of swaps fixes the curve, fills ramp, keeps the deck at 100, or pushes it over its target bracket, an agent has to save, call `get_deck`, and undo if it was wrong. Each round trip touches the player's real deck and its activity feed.
2. **Two-commander pairs aren't checked (`#74`).** `deckProblems` allows any two commanders as long as each can lead on its own (plus the Background special case). Two random legends with no Partner ability pass, so both the builder and a future `apply_changes` would wrongly report a deck as legal.

Doing them together means the new `apply_changes` reports pairing problems correctly from day one, and both changes live in the same files (`rules.ts`, `labels.ts`, `tools/decks.ts`).

**Out of scope:** Companion rules, "Signature spell" (Oathbreaker), and 60-card formats (task `#52`).

## 2. Commander pairs (`src/modules/decks/domain/rules.ts`)

### 2.1 Which pairs are allowed (Commander rules 702.124, 702.124i–k, 903.3c)

With two cards on the commander board, they must form one of these pairs; otherwise the deck has a `CommandersCantPair` problem:

| Pair                | Rule (read from rules text)                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Partner + Partner   | Both have the plain **Partner** keyword (not "Partner with", not a "Partner—" variant).                                                          |
| Partner with _X_    | Each says **Partner with** the other's name (_Pir_ + _Toothy_).                                                                                  |
| Partner—_Variant_   | Both have the same variant, e.g. **Partner—Survivors**, **Partner—Father & Son**.                                                                |
| Friends forever     | Both have **Friends forever**.                                                                                                                   |
| Choose a Background | One says **Choose a Background**; the other is a legendary **Background** (already allowed today as a commander; now the _pair_ is checked too). |
| Doctor's companion  | One has **Doctor's companion**; the other is a legendary **Time Lord Doctor** creature with no other creature types.                             |

- Detection is case-sensitive on the keyword (`Partner`, not the reminder text's lowercase "if both have partner"), using word boundaries so it works on the space-joined face text `deckView` builds.
- A single commander never has a pairing problem. Three or more already report `TooManyCommanders`; pairing isn't checked then.
- `invalidCommanders` keeps its meaning ("can this card be a commander at all"); pairing is a separate check, `pairProblem(commanders)`, exported for tests and the worker.

### 2.2 New problem

```ts
| Readonly<{ kind: "CommandersCantPair"; names: readonly [string, string] }>
```

`problemText`: _"Pir and Ruby Commander can't share the command zone: two commanders need Partner, Partner with each other, Friends forever, a Background with Choose a Background, or a Doctor with Doctor's companion."_

### 2.3 Checking against real data

Extend `pnpm worker check-commanders` to also run `pairProblem` on every precon with two commanders (precons always pair legally, so any failure is a gap in our patterns, the way Hearthhull found the Spacecraft rule). Today: 190 precon decks, 0 rejected.

## 3. Dry-run preview (`src/modules/decks/domain/preview.ts`)

### 3.1 Input

```ts
export type DeckChange = Readonly<{ oracleId: string; board: Board; quantity: number }>; // sets the count, 0 removes
```

The same "set the count" meaning as `set_deck_entry`, so a move is two changes (0 on `main`, 1 on `maybe`). Changes apply in order with `withEntry`; a later change to the same card and board wins.

### 3.2 Pure function

```ts
export function previewChanges(input: {
  format: Format;
  targetBracket: Bracket | null;
  before: readonly PreviewLine[]; // the deck's lines today
  changes: readonly DeckChange[];
  facts: (oracleId: string) => PreviewLine & { rules: CardRules }; // for cards new to the deck
}): ChangePreview;
```

`ChangePreview` holds **before** and **after** for:

- **Size:** card count vs. the format's size (`deckSize`), lands, other mana sources.
- **Curve:** the 0–7+ curve and average mana value.
- **Roles:** counts per role tag, with targets (`roleTargets`) for Commander, marking which targets a change newly meets or newly misses.
- **Colors:** pips and sources per color.
- **Problems:** `added` (new after the change), `resolved` (gone after it), and `remaining`, compared by `problemText` so "Short 2 of X" → "Short 1 of X" shows as resolved-and-added rather than silently equal.
- **Bracket (Commander):** floor and range before and after, and the over-target warning after (`estimateBracket`, `bracketWarning`).
- **Value:** deck price before/after and the difference; cards newly short and their total.
- **Changes as applied:** each card's old and new count per board, so the agent can echo exactly what would happen.

It never touches the database and has no clock, so it's unit-testable with made-up cards, like `rules.test.ts`.

### 3.3 Query (`src/modules/decks/queries/preview.ts`)

`deckChangePreview(db, userId, deckId, changes)`:

1. Loads `deckView` (null → deck not found).
2. Loads the same facts `deckView` reads (rules facts, mana, owned copies, price, Game Changer) for any changed card not already in the deck, through one query shared with `deckView` (extracted, not duplicated).
3. Calls `previewChanges`.

## 4. Saving the changes (`applyChanges` use case)

`decks.applyChanges(actor, { deckId, changes, fingerprint })` in `manage-decks.ts`:

- Runs in one unit of work: locks the deck, compares the **fingerprint** (design doc 23) so a preview made against an older deck can't be saved over newer edits (`DeckChanged`), checks every quantity and card, applies all changes, saves once. All or nothing.
- Errors: `DeckNotFound | DeckChanged | QuantityInvalid | CardNotFound`.

## 5. LLM tool (`apply_changes`, `src/app/_llm-tools/tools/decks.ts`)

- **Input:**
  - `deckId`
  - `changes`: 1–100 of `{ card, quantity, board }` (card name or id, as `set_deck_entry`).
  - `save`: boolean, default **false** (preview only).
  - `fingerprint`: required when `save` is true — the fingerprint from `get_deck` or from this tool's own preview.
- **Scope:** `decks:write` (because it can save); with `save: false` it changes nothing.
- **Output:** the preview from section 3.2 in words (`problemText`, `findingWithCards`, role labels), plus `fingerprint` of the deck as previewed, plus `saved: true|false`. Any card name that doesn't resolve fails the whole call with the names that didn't match, before anything is previewed or saved.
- **Description guidance:** "Preview first, show the player the differences, save only what they agreed to, passing the fingerprint from the preview."

## 6. Web UI

The builder already re-checks problems on every click (`derive.ts`), so a per-card preview adds nothing there. The place a preview helps is **Edit as text** (`src/app/decks/[id]/edit-as-text.tsx`), where a pasted list can change dozens of cards at once:

- A **Preview changes** button next to Save shows the same before/after summary (size, curve average, roles vs targets, problems added/resolved, bracket) from `deckChangePreview`, computed from the pasted list's difference to the current deck.
- Save is unchanged (still `replaceList` with the fingerprint).

**Decision D1 (decided 2026-11-11):** include the Edit as text preview in this phase: it's where big edits happen and it reuses the same query.

## 7. Tests

1. **`rules.test.ts`:** every allowed pair in 2.1 passes; mismatched pairs fail (Partner + non-partner, Partner with the wrong name, different Partner— variants, Friends forever + Partner, Doctor's companion + a Doctor with an extra creature type); one commander and three commanders don't report a pairing problem.
2. **`preview.test.ts`:** size/curve/roles/bracket before and after; problems added/resolved; a move (0 main, 1 maybe) leaves the count down by one; a later change to the same card wins; a Commander deck crossing its target bracket reports the warning only after.
3. **`manage-decks` unit test:** `applyChanges` is all-or-nothing and refuses a stale fingerprint.
4. **Integration (`tests/integration/apply-changes.int.test.ts`):** preview against Postgres including a card not yet in the deck, then save with the preview's fingerprint; a second save with the same (now stale) fingerprint returns `DeckChanged`.
5. **Worker:** `pnpm worker check-commanders` still reports 0 rejected precons with pairing checked.
