# Design: Public deck links without an account

- **Phase:** 47 (Roadmap #88)
- **Status:** **Approved**
- **Related ADRs:** 0016, 0023
- **Lesson:** no

## 1. Purpose & scope

Let a deck owner create a **public link** (`/d/[token]`) so anyone—including people without an account on the server—can open and read the deck, inspect its stats, bracket estimate, tokens, and test hands, and copy the list as text.

**Out of scope:**

- Copying a shared or public deck into your own decks in one click (tracked separately as #75).
- Public comments or unauthenticated editing.
- Exposing playgroup comments, other decks, or any player's collection/owned-card counts on a public link.

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public link / token | An unguessable, URL-safe random token (`decks.public_token`) that grants read-only access to `/d/[token]` without signing in.                              |
| Playgroup sharing   | `decks.visibility = 'shared'` (design doc 21): lists the deck on `/decks/shared` for signed-in players and enables comments. Independent of a public link. |

## 3. Domain model

In `src/modules/decks/domain/sharing.ts`:

- `DeckForSharing` gains `publicToken: string | null`.
- `isValidPublicToken(raw: string): boolean` — checks that a candidate token from a URL is a non-empty URL-safe string (`^[A-Za-z0-9_-]{16,64}$`) so malformed slugs short-circuit before hitting the database.

## 4. Invariants

1. **Owner-only management:** Only the deck's owner may enable, rotate, or revoke its public link. Anyone else receives `DeckNotFound` (never `Forbidden`).
2. **Unguessable, unique tokens:** Tokens are generated with 128 bits of cryptographic randomness (22-character base64url) and enforced unique across `decks.public_token`.
3. **Orthogonal to playgroup sharing:** Enabling, rotating, or revoking a public link does **not** change `visibility` (`'private'` vs `'shared'`), does **not** emit a `deckShared` activity event, and does **not** list the deck in `/decks/shared`.
4. **Immediate revocation & rotation:** Rotating replaces the previous token; revoking sets `public_token` to `null`. Both immediately make the old `/d/[token]` URL return 404.
5. **Zero-account read-only boundary:** `/d/[token]` works without a session cookie, performs no writes, omits `yourCopies` (no "you X" ownership badges), and omits playgroup comments.

## 5. Use cases

In `makeDeckSharing` (`src/modules/decks/application/sharing.ts`):

| Use case           | Actor / authz | Input        | Output                           | Errors (`kind`) | Transaction? |
| ------------------ | ------------- | ------------ | -------------------------------- | --------------- | ------------ |
| `enablePublicLink` | Owner         | `{ deckId }` | `string` (existing or new token) | `DeckNotFound`  | Yes          |
| `rotatePublicLink` | Owner         | `{ deckId }` | `string` (new token)             | `DeckNotFound`  | Yes          |
| `revokePublicLink` | Owner         | `{ deckId }` | `void`                           | `DeckNotFound`  | Yes          |

## 6. Ports

Extend `DeckSharingDependencies` / `DeckSharingRepository` (`src/modules/decks/application/ports.ts`):

```ts
export type DeckSharingRepository = Readonly<{
  lockDeck(deckId: DeckId): Promise<DeckForSharing | null>;
  setVisibility(deckId: DeckId, visibility: Visibility, firstSharedAt: Date | null): Promise<void>;
  setPublicToken(deckId: DeckId, publicToken: string | null): Promise<void>;
  // ...existing comment methods
}>;
```

Add `tokens: Readonly<{ newPublicToken(): string }>` to `DeckSharingDependencies`, wired in `src/server/core.ts` using `randomBytes(16).toString("base64url")`.

## 7. Persistence

In `src/modules/decks/infrastructure/schema.ts` (`decks` table):

- Add `publicToken: text("public_token")` (nullable).
- Add `uniqueIndex("decks_public_token_idx").on(table.publicToken)` (PostgreSQL allows multiple `NULL`s).
- Generate and apply the Drizzle migration.

## 8. Read models & routes

- **Query (`src/modules/decks/queries/sharing.ts`):**
  - `publicDeckByToken(db, token)` → `Promise<{ view: DeckView; ownerName: string } | null>`. Validates `isValidPublicToken(token)`, looks up `decks` + `auth_users` by `public_token`, and loads `deckView(db, ownerId, deckId)`.
  - `ViewedDeck` includes `publicToken: string | null` (populated for the owner).
- **Proxy (`src/proxy.ts`):**
  - Add `"/d/"` and `"/api/images/"` to `PUBLIC_PATHS` so unauthenticated visitors can open public deck pages and load card art.
- **Public page (`src/app/d/[token]/page.tsx`):**
  - Does not call `requireActor()`.
  - Loads `publicDeckByToken(db, token)`; calls `notFound()` if `null`.
  - Renders `SharedDeckView` with `yourCopies={undefined}` (requiring `yourCopies` to be optional on `SharedDeckView`, which `DeckList` already supports) and without `DeckComments`.
  - Sets `generateMetadata` title to `${deck.name} — Proxy Library` for clean link previews.
- **Owner UI (`src/app/decks/[id]/page.tsx`):**
  - Adds a compact "Public link" control in the header: "Create public link" when `null`; when active, displays the `/d/[token]` URL with a client Copy button, "New link" (rotate), and "Turn off" (revoke).

## 9. Test plan

- **Domain unit tests (`sharing.test.ts`):** `isValidPublicToken` accepts valid base64url tokens and rejects empty, short, or non-URL-safe strings.
- **Use-case tests (`application/sharing.test.ts`):** `enablePublicLink` (idempotent, owner-only, does not alter `visibility` or emit `deckShared`), `rotatePublicLink` (replaces token, owner-only), `revokePublicLink` (clears token, owner-only).
- **Proxy unit tests (`src/proxy.test.ts`):** `/d/<token>` and `/api/images/...` are allowed unauthenticated, while `/decks/42` still requires a session.
- **Full check:** `direnv exec . pnpm check` (typecheck, lint, cycles, format, tests).
