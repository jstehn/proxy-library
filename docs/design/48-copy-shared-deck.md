# Design: Copy a shared deck into your own in one click

- **Phase:** 48 (Roadmap #75)
- **Status:** **Approved**
- **Related ADRs:** 0009, 0016, 0023
- **Lesson:** no

## 1. Purpose & scope

Let any signed-in player copy a deck they can view—either a playgroup-shared deck (`/decks/[id]`) or a public deck link (`/d/[token]`)—into a new private deck of their own in one click, preserving its format, target bracket, card list, grouping, and custom headings.

**Out of scope:**

- Copying without an account (you must sign in to own a deck).
- Copying the source owner's playgroup comments, pinned printings/finishes, or personal card notes.

## 2. Domain model

In `src/modules/decks/domain/deck.ts`:

- `copyDeckName(sourceName: string): string` — produces `"<sourceName> (copy)"`, trimming `sourceName` if needed so the result stays within `MAX_NAME_LENGTH` (60 characters).

## 3. Invariants

1. **Readable-only authorization:** A player may copy a deck by ID only if `canViewDeck(actor.userId, deck)` holds (`ownerId === actor.userId || visibility === "shared"`), or by `publicToken` if `isValidPublicToken(token)` and a matching deck exists. Otherwise `DeckNotFound` is returned (never `Forbidden`).
2. **Deck cap:** Copying counts against `MAX_DECKS`; if the actor is already at the cap, `TooManyDecks` is returned and nothing is written.
3. **Clean ownership:** The copy belongs to the actor, starts with `visibility = "private"`, `origin = null`, `publicToken = null`, `usesRealCards = true`, `printingId = null`, `finish = null`, and `note = null` (so the copy automatically resolves printings from the actor's own collection).
4. **Structure preserved:** `format`, `targetBracket`, `grouping`, `headings`, and each entry's `oracleId`, `board`, `quantity`, and `heading` are copied intact.

## 4. Use cases

In `makeDecks` (`src/modules/decks/application/manage-decks.ts`):

| Use case   | Actor / authz    | Input                                                                    | Output   | Errors (`kind`)                | Transaction? |
| ---------- | ---------------- | ------------------------------------------------------------------------ | -------- | ------------------------------ | ------------ |
| `copyDeck` | Signed-in player | `{ source: { kind: "deck"; deckId } \| { kind: "publicToken"; token } }` | `DeckId` | `DeckNotFound`, `TooManyDecks` | Yes          |

## 5. Ports

In `DeckRepository` (`src/modules/decks/application/ports.ts`):

```ts
export type CopyDeckSource =
  | Readonly<{ kind: "deck"; deckId: DeckId; viewerId: UserId }>
  | Readonly<{ kind: "publicToken"; token: string }>;

// Added to DeckRepository:
findReadable(source: CopyDeckSource): Promise<Deck | null>;
```

## 6. UI

- **Shared deck page (`src/app/decks/[id]/page.tsx` when `!viewed.isOwner`):** Add a **"Copy to my decks"** form button in the header (`copyDeckAction`).
- **Public deck link (`src/app/d/[token]/page.tsx`):** When `getCurrentActor()` is signed in, show the same **"Copy to my decks"** button in the header (`copyPublicDeckAction` passing `token`).
- Both actions redirect to `/decks/${newDeckId}` on success, or redirect back with `?error=...` if `TooManyDecks` is hit.

## 7. Test plan

- **Domain unit tests (`deck.test.ts`):** `copyDeckName` appends `" (copy)"` and truncates long names within `MAX_NAME_LENGTH`.
- **Use-case tests (`decks.test.ts`):** `copyDeck` from a shared deck, from a public token, rejects private decks of another player with `DeckNotFound`, enforces `MAX_DECKS`, preserves `format`, `targetBracket`, `grouping`, `headingOrder`, and entry `heading`s while clearing `printingId`, `finish`, and `note`.
- **Integration test (`tests/integration/sharing.int.test.ts`):** `copyDeck` against real Postgres for both shared `deckId` and `publicToken`.
- **Full check:** `direnv exec . pnpm check`.
