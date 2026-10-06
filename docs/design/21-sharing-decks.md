# Design: sharing decks, comments, and cards to get

- **Phase:** 21
- **Status:** **Approved** (2026-10-06, after review; self-approved during the overnight run of
  2026-10-02 → 03, judgement calls in [decisions-to-review.md](../decisions-to-review.md))
- **Related:** design doc 09 (decks, ownership shared between decks), design doc 11 (activity
  feed), design doc 12 (reset), design doc 15 (buy a list), ADR 0006 (cross-module reads)

## 1. Purpose & scope

From [future-ideas.md](../future-ideas.md): **sharing decks** with the playgroup (read-only),
**deck comments**, and a **"cards to get" list across all your decks**. Decided before the run:
shared decks are seen by **signed-in players only** (no public links; `proxy.ts` is unchanged).

- An owner can mark a deck **shared**. Every player can then open it read-only: the list, the
  statistics, test hands, the list as text, and how many of each card **they** own.
- Anyone who can see a deck can **comment** on it. A comment can be deleted by its author, the
  deck's owner or an admin.
- **Decks → Shared** lists every shared deck. The activity feed says when a deck is first shared
  and when someone comments on yours.
- **Decks → Cards to get** lists every card your decks need that you don't own, with store
  prices and one "buy them all" link.

**Out of scope:** public links without an account, copying someone else's deck into your own
(a pasted list does that today), replies and editing comments, and e-mail notifications.

## 2. Ubiquitous language

| Term             | Meaning                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Visibility**   | `private` (only the owner) or `shared` (every signed-in player can view and comment).                                             |
| **Viewer**       | A signed-in player looking at someone else's shared deck.                                                                         |
| **Comment**      | A short note (1–1 000 characters) on a deck, by any player who can see it. Deleting one leaves "comment removed" in its place.    |
| **Cards to get** | For each card your decks use: the most any one deck needs, minus what you own (ownership is shared between decks, design doc 09). |

## 3. Domain model

```ts
// src/modules/decks/domain/sharing.ts
export const VISIBILITIES = ["private", "shared"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type DeckForSharing = Readonly<{
  id: DeckId;
  ownerId: UserId;
  name: string;
  visibility: Visibility;
  firstSharedAt: Date | null;
}>;
export type DeckComment = Readonly<{
  id: CommentId;
  deckId: DeckId;
  authorId: UserId;
  deletedAt: Date | null;
}>;

export const MAX_COMMENT_LENGTH = 1000;
export function checkCommentBody(raw: string): Result<string, CommentInvalid>; // trimmed, 1–1000

// Policies (pure): who may do what.
export function canViewDeck(
  viewer: UserId,
  deck: Pick<DeckForSharing, "ownerId" | "visibility">,
): boolean;
export function canDeleteComment(
  actor: Pick<Actor, "userId" | "isAdmin">,
  comment: DeckComment,
  deck: Pick<DeckForSharing, "ownerId">,
): boolean;

/** Cards to get: the most any one deck needs, minus what you own (never negative). */
export function cardsToGet(
  needs: readonly DeckNeed[],
  owned: ReadonlyMap<string, number>,
): CardToGet[];
```

New errors: `CommentInvalid { maximum }`, `CommentNotFound`, `NotAllowed`.

## 4. Invariants

1. A private deck is visible only to its owner. To anyone else, it's "not found", never
   "forbidden", so its existence doesn't leak.
2. Only the owner changes visibility. A deck is announced in the feed **once**, the first time
   it's shared (`first_shared_at`), so switching it back and forth doesn't fill the feed.
3. A comment needs a deck its author can see now. Making a deck private keeps its comments, but
   only the owner sees them until it's shared again.
4. Deleting a comment is allowed for its author, the deck's owner and admins, and does it at most
   once. A deleted comment keeps its place and author, without its text.
5. Commenting on someone else's deck records one feed event; commenting on your own records none.
6. Cards to get: for each oracle card (basic lands never), `max over decks(copies needed)` minus
   copies owned, if more than zero. It's never the sum: one copy serves every deck (design doc 09).
7. Resetting a player deletes their decks (comments on those decks go with them) and the feed's
   "shared a deck" events for them. Their comments on **other** players' decks stay: like trades,
   they're part of someone else's conversation.
8. **The feed shows a deck's events only while the deck exists and is shared** (added after
   review, 2026-10-06). Otherwise "commented on Jack's deck" survived Jack's reset and linked to a
   deleted deck, and a deck made private again still showed its name. `activityFeed` checks this
   when reading, so making the deck shared again brings its events back.

## 5. Use cases

| Use case        | Actor / authz             | Input              | Output      | Errors                           | Transaction?                           |
| --------------- | ------------------------- | ------------------ | ----------- | -------------------------------- | -------------------------------------- |
| `setVisibility` | owner                     | deckId, visibility | —           | `DeckNotFound`                   | yes: deck locked; event on first share |
| `postComment`   | anyone who can see it     | deckId, body       | `CommentId` | `DeckNotFound`, `CommentInvalid` | yes: deck locked; event if not owner   |
| `deleteComment` | author, deck owner, admin | commentId          | —           | `CommentNotFound`, `NotAllowed`  | yes: comment locked                    |

They live in a new `makeDeckSharing` factory with its own services (`deckSharing` repository +
the activity recorder), so the existing deck use cases and their fakes don't change.

## 6. Ports

```ts
export interface DeckSharingRepository {
  /** The deck, locked until the transaction ends, or null. */
  lockDeck(deckId: DeckId): Promise<DeckForSharing | null>;
  setVisibility(deckId: DeckId, visibility: Visibility, firstSharedAt: Date | null): Promise<void>;
  addComment(input: {
    deckId: DeckId;
    authorId: UserId;
    body: string;
    at: Date;
  }): Promise<CommentId>;
  /** The comment, locked, with its deck's owner, or null. */
  lockComment(commentId: CommentId): Promise<(DeckComment & { deckOwnerId: UserId }) | null>;
  markDeleted(commentId: CommentId, at: Date): Promise<void>;
}
export type DeckSharingServices = { deckSharing: DeckSharingRepository } & ActivityServices;
```

## 7. State machines

Visibility: `private ⇄ shared` (owner only). A comment: `posted → removed` (once).

## 8. Persistence

- `decks.visibility text not null default 'private'` (check `in ('private', 'shared')`),
  `decks.first_shared_at timestamptz null`; index on `visibility` for the shared list.
- `deck_comments`: `id bigserial`, `deck_id → decks on delete cascade`, `author_id → players`,
  `body text not null` (check 1–1 000 characters), `created_at`, `deleted_at null`,
  `deleted_by → players null`. Index `(deck_id, created_at)`.

## 9. Read models (queries)

- `deckForViewer(db, viewerId, deckId)`: the deck as `deckView` shows it to its owner (the
  **owner's** ownership and problems), if the viewer can see it, plus the owner's name, its
  visibility, whether the viewer is the owner, and the viewer's own copies of each card.
- `deckComments(db, deckId)`: oldest first, with authors' names; deleted ones without text.
- `sharedDecks(db)`: every shared deck, newest change first: name, owner, format, card count,
  commanders' names, comment count.
- `cardsToGetFor(db, userId)`: section 3's `cardsToGet` over the player's decks, with each
  card's cheapest store price (as Buy a list would pick it) and the decks that want it.
- `decksFor` (the deck list) also returns each deck's visibility.
- Activity feed: two new kinds, `deckShared` ("Jack shared a Commander deck: Beza") and
  `deckComment` ("Sam commented on Jack's deck Beza"), each linking to the deck.

## 10. Events emitted

`deckShared { actorId, deckId, deckName, format }` (first share only) and
`deckComment { actorId, otherId: ownerId, deckId, deckName }` (not on your own deck).
`forgetPullsAndPurchases` becomes `forgetLibraryEvents` and also forgets `deckShared`
(invariant 7).

## 11. Patterns applied

- **Policies as pure functions** (accounts' `Actor` checks): `canViewDeck`, `canDeleteComment`.
- **Not found, not forbidden** for things you may not know exist (design doc 09, rule 7).
- **Soft delete** for comments: the thread keeps its shape; the text goes.
- **An event in the same transaction** as the change (design doc 11).
- **Max, not sum**, because one copy serves many decks: computed in pure TypeScript and tested.

## 12. Test plan

- **Unit:** `checkCommentBody`, both policies (every role), `cardsToGet` (two decks wanting
  one card, basics skipped, owned enough → nothing); use cases against fakes (owner-only
  visibility, the first-share event only once, comment events not on your own deck, delete
  rights, a deleted comment deleted again is fine).
- **Integration:** visibility and comments through Drizzle; `deckForViewer` for owner, viewer of
  a shared deck, and a private deck (null); `sharedDecks`; `cardsToGetFor` with two decks;
  reset keeps comments on others' decks and forgets "shared" events.
- **E2E:** the admin shares a deck; a second player finds it under Decks → Shared, opens it,
  sees "you own", comments; the admin sees the comment and the feed item and deletes it; Cards to
  get lists the short cards. Screenshots in dark mode and at phone width.

## 13. Decisions (self-approved, then approved by you on 2026-10-06; see decisions-to-review.md)

1. Signed-in players only (decided before the run).
2. Shared decks show the **owner's** problems and ownership, plus "you own" for the viewer.
3. Viewers get the list as text (to paste into their own deck), not the owner's export or
   proxy pages.
4. Comments: plain text, 1 000 characters, no editing, no replies.
5. Reset keeps comments on others' decks (invariant 7).
