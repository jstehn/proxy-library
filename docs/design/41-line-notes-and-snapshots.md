# Design: Line notes and deck snapshots

- **Phase:** 41 (tududi task `#47`, project "Build decks from owned cards")
- **Status:** **Approved** (2026-11-11)
- **Related:** design doc 09 (decks), design doc 21 (sharing), design doc 23 (Edit as text, fingerprints), design doc 28 (LLM tool API), design doc 32 (maybeboard & cuts), design doc 34 (custom deck headings), design doc 40 (`apply_changes` dry-run comparison)
- **Lesson:** no (column on `deck_entries`, new `deck_snapshots` table, and reuses `preview.ts` diffing)

## 1. Purpose & scope

Two gaps make iterating on a deck and trimming cuts harder than it needs to be:

1. **No line notes ("why is this card here?").** Once a deck reaches 100 cards (plus a maybeboard of cuts), it is easy to forget why a niche piece stayed in ("Combos with Deadeye Navigator", "Budget fill until Demonic Tutor", "Testing over Arcane Denial"). Both the player in the builder and an LLM agent reviewing cuts need short per-line notes saved with the deck.
2. **No deck snapshots to compare before/after cuts.** `apply_changes` (design doc 40) previews one batch before saving, but trimming a deck often spans many individual moves to the maybeboard, suggestions added in the builder, or multiple sessions. Players need named point-in-time snapshots (e.g. `"Before cuts"`, `"Goldfish v1"`) so they can inspect what changed, compare stats/curve/roles/bracket/problems between a snapshot and the current deck (or between any two snapshots), and optionally restore an earlier version.

**Out of scope:** multi-line Markdown primers inside `note`, inline note syntax in Edit as text (`deckText` / `parseList`), automatic scheduled snapshots, and sharing private snapshots on another player's shared deck view (notes _do_ show read-only on shared decks when non-null, just like custom headings).

## 2. Ubiquitous language

| Term       | Meaning in this codebase                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Line note  | A trimmed, single-line explanation (`1..200` chars) attached to one `(oracleId, board)` deck entry, or `null`. |
| Snapshot   | An immutable point-in-time copy of a deck's label, format, target bracket, grouping, headings, and entries.    |
| Comparison | A before/after diff between two states (snapshot vs. current deck, or two snapshots) using `preview.ts`.       |

## 3. Domain model & pure functions

### 3.1 Line notes (`src/modules/decks/domain/deck.ts`, `notes.ts`)

```ts
// decks/domain/notes.ts (new, pure)
export const MAX_NOTE_LENGTH = 200;

/**
 * Normalizes whitespace to single spaces and checks length (1..200 chars).
 * Clearing is represented by passing `null` at the application boundary (or `""` in UI/MCP).
 */
export function checkNote(raw: string): Result<string, NoteInvalid>;

// decks/domain/errors.ts
export type NoteInvalid = Readonly<{ kind: "NoteInvalid"; maximum: number }>;
export type SnapshotNotFound = Readonly<{ kind: "SnapshotNotFound" }>;
export type SnapshotLabelInvalid = Readonly<{ kind: "SnapshotLabelInvalid"; maximum: number }>;
export type TooManySnapshots = Readonly<{ kind: "TooManySnapshots"; maximum: number }>;

// decks/domain/deck.ts
export type DeckEntry = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  printingId: PrintingId | null;
  finish: Finish | null;
  heading: string | null;
  /** Why this card is in the deck (design doc 41), or null. */
  note: string | null;
}>;
```

Entry transformation rules:

- `withEntry` keeps `existing.note` unless `change.note` is explicitly provided (`change.note !== undefined`). Setting quantity to `0` removes the entry (and its note).
- `movedEntry` preserves `moving.note ?? there?.note ?? null` so moving a card between `main`, `side`, and `maybe` keeps its reason attached.
- `replacedEntries` (`chosenVersion`) preserves `existing.note ?? null` when cards stay in the deck across Edit as text / `replace_deck_list`, so editing plain text never erases line notes.
- `fingerprint` continues to hash the entry's cards/quantities/printings/finishes/headings (not `note`) or — if included? Excluding `note` avoids false `DeckChanged` conflicts when editing text alongside note updates, because `replacedEntries` preserves notes from the locked deck anyway.
- `stats`, `problems`, `brackets`, `cuts`, and `proxies` ignore `note`.

### 3.2 Deck snapshots & comparisons (`src/modules/decks/domain/snapshots.ts`, `preview.ts`)

```ts
// decks/domain/snapshots.ts (new, pure)
export type SnapshotId = Brand<number, "SnapshotId">;
export const MAX_SNAPSHOT_LABEL_LENGTH = 60;
export const MAX_SNAPSHOTS_PER_DECK = 30;

export function checkSnapshotLabel(raw: string): Result<string, SnapshotLabelInvalid>;

export type SnapshotEntry = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  printingId: PrintingId | null;
  finish: Finish | null;
  heading: string | null;
  note: string | null;
}>;

export type DeckSnapshot = Readonly<{
  id: SnapshotId;
  deckId: DeckId;
  label: string;
  format: Format;
  targetBracket: Bracket | null;
  grouping: Grouping;
  headings: readonly string[];
  entries: readonly SnapshotEntry[];
  createdAt: Date;
}>;
```

Comparison (`src/modules/decks/domain/preview.ts`):

- Extract the shared diff core from `previewChanges` into `compareStates({ format, targetBracket, before, after, changes? })`, reused by both `previewChanges` (dry-run `apply_changes`) and `compareDeckStates` (snapshot diffs).
- For comparing two deck states (`beforeLines`, `afterLines`), derive `changes: AppliedChange[]` for every `(oracleId, board)` present in either state whose `beforeQuantity !== afterQuantity` (sorted by board order `commander`, `main`, `side`, `maybe`, then card name), and run the same size, mana curve, average MV, pips/sources, role deltas (`newlyMetRoles`, `newlyMissedRoles`), problems (`added`, `resolved`, `remaining`), Commander bracket, price delta, and newly-short summary.
- Also compute `moves` / note context cleanly if a card went `main -> maybe` (`before` had it on `main`, `after` increased it on `maybe`), or present per-board `changes` consistently with `apply_changes`.

## 4. Invariants

1. A line note is either `null` or trimmed single-line text of `1..200` characters (`MAX_NOTE_LENGTH`).
2. `withEntry` (when omitting `note`), `movedEntry`, and `replacedEntries` preserve an entry's existing `note`.
3. A deck may hold at most `30` snapshots (`MAX_SNAPSHOTS_PER_DECK`); saving past the limit fails cleanly with `TooManySnapshots`.
4. Snapshot labels are trimmed and `1..60` characters (`MAX_SNAPSHOT_LABEL_LENGTH`).
5. Snapshots are strictly scoped to the deck owner; another player's deck or snapshot is reported as `DeckNotFound` / `SnapshotNotFound`.
6. Deleting a deck cascades to its snapshots (`ON DELETE CASCADE`).
7. Restoring a snapshot is atomic (single transaction, optional `fingerprint` guard in web/MCP if passed) and keeps existing snapshots intact so the player can always compare or switch back.

## 5. Use cases (`src/modules/decks/application/manage-decks.ts`)

| Use case          | Actor / authz | Input                                               | Output                   | Errors (`kind`)                                            | Tx? |
| ----------------- | ------------- | --------------------------------------------------- | ------------------------ | ---------------------------------------------------------- | --- |
| `setEntryNote`    | Owner only    | `{ deckId, oracleId, board, note: string \| null }` | `void`                   | `DeckNotFound \| EntryNotFound \| NoteInvalid`             | Yes |
| `setEntry`        | Owner only    | Existing fields + optional `note?: string \| null`  | `void`                   | Existing + `NoteInvalid`                                   | Yes |
| `applyChanges`    | Owner only    | Changes may carry optional `note?: string \| null`  | `ApplyChangesReport`     | Existing + `NoteInvalid`                                   | Yes |
| `saveSnapshot`    | Owner only    | `{ deckId, label }`                                 | `SnapshotId`             | `DeckNotFound \| SnapshotLabelInvalid \| TooManySnapshots` | Yes |
| `restoreSnapshot` | Owner only    | `{ deckId, snapshotId, fingerprint? }`              | `{ cards, fingerprint }` | `DeckNotFound \| SnapshotNotFound \| DeckChanged`          | Yes |
| `deleteSnapshot`  | Owner only    | `{ deckId, snapshotId }`                            | `void`                   | `DeckNotFound \| SnapshotNotFound`                         | Yes |

Note on `restoreSnapshot`: before writing `deck_entries`, check which `printingId`s in `snapshot.entries` still exist in `printings` (clearing any missing `printingId`/`finish` to `null`) and skip or flag missing `oracleId`s if catalog ever dropped one, using `tidyHeadings` so `headingOrder` stays consistent.

## 6. Persistence (`src/modules/decks/infrastructure/schema.ts`, migration `0037`)

1. **`deck_entries` column:**
   - Add nullable `note text` with check constraint `deck_entries_note_length`:
     `note is null or char_length(note) between 1 and 200`.
2. **`deck_snapshots` table:**
   - `id bigserial primary key`
   - `deck_id bigint not null references decks(id) on delete cascade`
   - `label text not null` (`check char_length(label) between 1 and 60`)
   - `format text not null` (same known-format check)
   - `target_bracket smallint` (same bracket check)
   - `grouping text not null` (`'type' | 'custom'`)
   - `heading_order text[] not null default '{}'::text[]`
   - `entries jsonb not null`
   - `created_at timestamptz not null`
   - Index `deck_snapshots_deck_idx` on `(deck_id, created_at desc)`.
3. **`DeckSnapshotRepository` port** in `application/ports.ts` (implemented in `drizzle-repositories.ts` or `drizzle-snapshots.ts` and wired into `DecksServices`).

## 7. Queries (`src/modules/decks/queries/`)

1. **`deckView` (`decks.ts`):** include `note: string | null` on `DeckLine` (`deckForViewer` inherits it automatically so `SharedDeckView` can display line notes read-only too).
2. **`snapshots.ts` (new query module):**
   - `listDeckSnapshots(db, userId, deckId)`: returns `SnapshotSummary[]` (`id`, `label`, `format`, `cardCount`, `createdAt`), newest first, or `null` if not owned.
   - `compareDeckSnapshot(db, userId, deckId, beforeSnapshotId, afterSnapshotId?)`:
     - Loads `deckView(db, userId, deckId)` and the requested snapshot(s) owned by `deckId`.
     - Collects all `oracleId`s from the snapshot(s) not already in `view.lines` and loads their facts in one call via `loadCardsForPreview` (shared from `queries/preview.ts`).
     - Calls `compareDeckStates(...)` and returns `SnapshotComparison` (`before` metadata, `after` metadata, plus full `ChangePreview` stats/roles/problems/bracket/price/changes).

## 8. Web UI & MCP Tools

### 8.1 Web UI (`src/app/decks/[id]/`)

- **`DeckList` (`builder/deck-list.tsx`):** when `line.note !== null`, show it as a compact muted second line under the card row (in both the builder and `SharedDeckView`, including "By type", "By heading", and "By role" views).
- **Selected-card panel (`builder/note-field.tsx`, wired in `deck-builder.tsx`):** right next to `HeadingField` (and on **any board**, unlike `HeadingField` which is `main` only), render `<NoteField />` with Save / Clear (`None`) buttons when the selected card is in the deck.
- **Snapshots panel (`builder/snapshots-panel.tsx`, wired in `deck-builder.tsx` + `builder/actions.ts`):**
  - Add a `"Snapshots"` button in the builder's tool row alongside Suggestions / Possible cuts / Mana base / Draft deck / Test hand.
  - Inside the panel:
    - Form to save a snapshot (`"Label"` input, e.g. `"Before cuts"`, `"Save snapshot"`).
    - List of saved snapshots with card count & timestamp, plus:
      - **Compare vs current** (and a selector to compare two saved snapshots `"Before"` vs `"After"`): displays card count / average MV / deck value deltas, bracket shift, role deltas, problems resolved/added, and card changes (added, removed/cut, board moves like `main -> maybe`).
      - **Restore** button (restores that snapshot into the live deck and refreshes builder state).
      - **Delete** button.

### 8.2 MCP tools (`src/app/_llm-tools/tools/decks.ts`)

- **`get_deck`:** include `note` on each returned line when non-null.
- **`set_deck_entry`:** add optional `note` (`""` clears it, omitted preserves current note, errors with `NoteInvalid` if > 200 chars after trim).
- **`apply_changes`:** add optional `note` on each entry in `changes` (`""` clears it, omitted keeps current note).
- **`deck_snapshots` (`readOnly: true`, `scope: "read"`):**
  - Inputs: `deckId`, optional `snapshotId`, optional `compareToSnapshotId`.
  - Without `snapshotId`: returns `{ deck, snapshots: [...] }`.
  - With `snapshotId`: compares `snapshotId` ("before") against `compareToSnapshotId` (if given) or the live deck ("after", default), using the same response formatter as `apply_changes` plus `{ beforeLabel, afterLabel }`.
- **`snapshot_deck` (`readOnly: false`, `scope: "decks:write"`):**
  - Inputs: `deckId`, `action: z.enum(["save", "restore", "delete"]).default("save")`, optional `label` (for `save`), optional `snapshotId` (for `restore` / `delete`), optional `fingerprint` (for `restore`).

## 9. Test plan

- **Domain unit tests:**
  - `notes.test.ts`: `checkNote` whitespace/trimming/length boundaries (`1..200`, empty, too long); `withEntry`, `movedEntry`, `replacedEntries` preserving/updating/clearing `note`.
  - `snapshots.test.ts` & `preview.test.ts`: `checkSnapshotLabel`; `compareDeckStates` across additions, cuts, moves (`main -> maybe`), curve/role/problem/bracket/price diffs, and parity with `previewChanges`.
- **Use-case tests (`decks.test.ts` with fakes):**
  - `setEntryNote`, `setEntry` with `note`, `applyChanges` with `note`.
  - `saveSnapshot`, `MAX_SNAPSHOTS_PER_DECK` enforcement, `restoreSnapshot` (including `DeckChanged` when fingerprint mismatches), `deleteSnapshot`, owner-only isolation.
- **Integration tests (`tests/integration/`):**
  - Drizzle persistence for `deck_entries.note`, `deck_snapshots` CRUD + cascade delete, `listDeckSnapshots`, and `compareDeckSnapshot` against real Postgres + catalog data.
- **UI component tests / E2E / MCP tool tests:**
  - Tool registry + integration checks for `set_deck_entry` / `get_deck` / `apply_changes` notes and `deck_snapshots` / `snapshot_deck`.
  - Full `pnpm check` (`typecheck`, `lint`, `cycles`, `format`, `tests`) and `pnpm test:int`.
