# Design: User profiles & friends (social)

- **Phase:** 48
- **Status:** **Approved**
- **Related ADRs:** 0001, 0002, 0003, 0006, 0008, 0009
- **Lesson:** no

## 1. Purpose & scope

The `social` module (`src/modules/social/`) gives players a customizable public profile (bio, favorite colors and formats, showcase deck and cards, and per-section privacy controls) and a mutual friends system (friend requests, friends list, and player directory). It also connects existing features around players: filtering the Activity feed to friends, linking to profiles from trades/activity/decks, and quick actions on a profile (add friend, propose trade, view wishlist, view shared decks).

**Out of scope:**

- Direct messaging or chat (the playgroup communicates outside the app).
- Blocking or moderation queues (invite-only playgroup; admins can disable accounts in `accounts`).
- Public unauthenticated profiles (all profile and friend pages require a signed-in `Actor`).
- One-way following.

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Player profile**  | A player's optional public customization: bio, favorite mana colors, favorite formats, showcase deck, up to 3 showcase cards, and privacy settings.   |
| **Privacy section** | Visibility setting (`"everyone"`, `"friends"`, `"only_me"`) controlling who can see a player's economy/collection stats or wishlist on their profile. |
| **Friendship**      | A mutual connection between two distinct active players, either `"pending"` (requested, awaiting answer) or `"accepted"`.                             |
| **Viewer relation** | How the signed-in viewer relates to a profile owner: `"self"`, `"friend"`, `"pending_outgoing"`, `"pending_incoming"`, or `"none"`.                   |

## 3. Domain model

```ts
export const MAX_BIO_LENGTH = 500;
export const MAX_SHOWCASE_CARDS = 3;

export const MANA_COLORS = ["W", "U", "B", "R", "G"] as const;
export type ManaColor = (typeof MANA_COLORS)[number];

export const VISIBILITIES = ["everyone", "friends", "only_me"] as const;
export type SectionVisibility = (typeof VISIBILITIES)[number];

export type PlayerProfile = Readonly<{
  userId: UserId;
  bio: string;
  favoriteColors: readonly ManaColor[];
  favoriteFormats: readonly Format[];
  showcaseDeckId: DeckId | null;
  showcasePrintingIds: readonly PrintingId[];
  statsVisibility: SectionVisibility;
  wishlistVisibility: SectionVisibility;
  updatedAt: Date;
}>;

export type FriendshipStatus = "pending" | "accepted";

export type Friendship = Readonly<{
  requesterId: UserId;
  addresseeId: UserId;
  status: FriendshipStatus;
  createdAt: Date;
  acceptedAt: Date | null;
}>;

export type ViewerRelation = "self" | "friend" | "pending_outgoing" | "pending_incoming" | "none";
```

Pure domain functions:

- `defaultProfile(userId, now)`: returns an empty profile (`bio: ""`, `favoriteColors: []`, `favoriteFormats: []`, `showcaseDeckId: null`, `showcasePrintingIds: []`, `statsVisibility: "everyone"`, `wishlistVisibility: "friends"`).
- `checkBio(raw)`: trims and validates length `<= 500`.
- `checkShowcaseCards(printingIds)`: deduplicates and enforces length `<= 3`.
- `canViewSection(visibility, relation)`: returns `true` when `relation === "self"`, or `visibility === "everyone"`, or (`visibility === "friends"` and `relation === "friend"`).
- `viewerRelation(viewerId, targetId, friendship)`: computes `ViewerRelation`.

## 4. Invariants

1. A player cannot send a friend request to themselves (`requesterId !== addresseeId`).
2. At most one `friendships` row may exist for any unordered pair of players `{A, B}` (enforced in the DB with a unique index on `(least(requester_id, addressee_id), greatest(requester_id, addressee_id))`).
3. Only the `addresseeId` of a `"pending"` request may accept or decline it.
4. Only the `requesterId` of a `"pending"` request may cancel it.
5. Either participant of an `"accepted"` friendship may unfriend (remove the row).
6. A player's `bio` is at most 500 characters after trimming.
7. A player's `showcasePrintingIds` contains at most 3 distinct printing IDs.
8. A `showcaseDeckId`, if set, must belong to the profile owner and have `visibility = "shared"` (a private deck cannot be showcased publicly).
9. Disabled players cannot send/accept friend requests, and do not appear in the player search directory.

## 5. Use cases

| Use case               | Actor / authz                         | Input                                                                                                                | Output          | Errors (`kind`)                                                                    | Transaction? |
| ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------- | ------------ |
| `updateProfile`        | Signed-in `Actor` (own profile)       | `{ bio, favoriteColors, favoriteFormats, showcaseDeckId, showcasePrintingIds, statsVisibility, wishlistVisibility }` | `PlayerProfile` | `BioTooLong`, `TooManyShowcaseCards`, `InvalidShowcaseDeck`, `InvalidShowcaseCard` | Yes          |
| `sendFriendRequest`    | Signed-in `Actor`                     | `{ targetUserId }`                                                                                                   | `Friendship`    | `CannotFriendSelf`, `PlayerNotFound`, `AlreadyFriends`, `RequestAlreadyPending`    | Yes          |
| `acceptFriendRequest`  | Signed-in `Actor` (must be addressee) | `{ requesterId }`                                                                                                    | `Friendship`    | `RequestNotFound`, `NotAddressee`, `AlreadyFriends`                                | Yes          |
| `declineFriendRequest` | Signed-in `Actor` (must be addressee) | `{ requesterId }`                                                                                                    | `void`          | `RequestNotFound`, `NotAddressee`, `AlreadyFriends`                                | Yes          |
| `cancelFriendRequest`  | Signed-in `Actor` (must be requester) | `{ addresseeId }`                                                                                                    | `void`          | `RequestNotFound`, `NotRequester`, `AlreadyFriends`                                | Yes          |
| `unfriend`             | Signed-in `Actor` (either side)       | `{ friendUserId }`                                                                                                   | `void`          | `FriendshipNotFound`                                                               | Yes          |

Note on `sendFriendRequest`: if the target player already has a `"pending"` request _to_ the actor, `sendFriendRequest` returns `RequestAlreadyPending` (UI offers "Accept request" instead of "Add friend").

## 6. Ports

```ts
export interface ProfileRepository {
  findByUserId(userId: UserId): Promise<PlayerProfile | null>;
  save(profile: PlayerProfile): Promise<void>;
}

export interface FriendshipRepository {
  findBetween(a: UserId, b: UserId): Promise<Friendship | null>;
  insert(friendship: Friendship): Promise<void>;
  markAccepted(requesterId: UserId, addresseeId: UserId, acceptedAt: Date): Promise<void>;
  deleteBetween(a: UserId, b: UserId): Promise<void>;
}

export interface PlayerLookup {
  isActivePlayer(userId: UserId): Promise<boolean>;
}

export interface ShowcaseValidator {
  isOwnedSharedDeck(ownerId: UserId, deckId: DeckId): Promise<boolean>;
  allPrintingsExist(printingIds: readonly PrintingId[]): Promise<boolean>;
}
```

## 7. State machines

Friendship lifecycle per unordered pair `{A, B}`:

| From       | Event                       | Guard                    | To                                           |
| ---------- | --------------------------- | ------------------------ | -------------------------------------------- |
| _(none)_   | `sendFriendRequest(A -> B)` | `A !== B`, `B` is active | `pending` (`requester = A`, `addressee = B`) |
| `pending`  | `acceptFriendRequest(B)`    | actor is `addressee`     | `accepted` (`acceptedAt = now`)              |
| `pending`  | `declineFriendRequest(B)`   | actor is `addressee`     | _(none)_ (row deleted)                       |
| `pending`  | `cancelFriendRequest(A)`    | actor is `requester`     | _(none)_ (row deleted)                       |
| `accepted` | `unfriend(A or B)`          | actor is participant     | _(none)_ (row deleted)                       |

## 8. Persistence

Owned by `src/modules/social/infrastructure/schema.ts`:

1. **`player_profiles`**
   - `user_id` `text` PK, references `players.user_id` (`onDelete: "cascade"`)
   - `bio` `text` not null default `""`, check `char_length(bio) <= 500`
   - `favorite_colors` `text[]` not null default `'{}'::text[]`
   - `favorite_formats` `text[]` not null default `'{}'::text[]`
   - `showcase_deck_id` `bigint` nullable, references `decks.id` (`onDelete: "set null"`)
   - `showcase_printing_ids` `text[]` not null default `'{}'::text[]`, check `cardinality(showcase_printing_ids) <= 3`
   - `stats_visibility` `text` not null default `'everyone'`, check `in ('everyone', 'friends', 'only_me')`
   - `wishlist_visibility` `text` not null default `'friends'`, check `in ('everyone', 'friends', 'only_me')`
   - `updated_at` `timestamptz` not null

2. **`friendships`**
   - `requester_id` `text` not null, references `players.user_id` (`onDelete: "cascade"`)
   - `addressee_id` `text` not null, references `players.user_id` (`onDelete: "cascade"`)
   - `status` `text` not null, check `in ('pending', 'accepted')`
   - `created_at` `timestamptz` not null
   - `accepted_at` `timestamptz` nullable
   - Primary key `(requester_id, addressee_id)`
   - Check `requester_id <> addressee_id`
   - Check `(status = 'accepted') = (accepted_at is not null)`
   - Unique index `friendships_pair_idx` on `(least(requester_id, addressee_id), greatest(requester_id, addressee_id))`
   - Index `friendships_addressee_pending_idx` on `(addressee_id)` where `status = 'pending'`

Migration: generated with `pnpm db:generate` and applied with `pnpm db:migrate`. Note that `reset` (Start over) intentionally preserves `player_profiles` and `friendships` since they are social identity, not economy/cards.

## 9. Read models & UI

- **`/friends` (Friends & Players directory)**:
  - Incoming friend requests (Accept / Decline)
  - Accepted friends list (links to `/players/[id]`, "Propose trade" -> `/trades/new?with=[id]`, Unfriend)
  - Outgoing pending requests (Cancel)
  - Player search by username/display name (`searchPlayers`) with relation status & quick action.
  - Header nav link `Friends` with a badge showing incoming pending request count (`incomingRequestCount`).
- **`/players/[id]` (Player Profile page)**:
  - Display name, `@username`, member since, friend status badge & action button (Add friend / Accept / Decline / Cancel / Unfriend), "Propose trade" button.
  - Bio, favorite mana colors (rendered with `mana-font`), favorite formats.
  - Showcase deck (card with link to `/decks/[deckId]`) & up to 3 showcase cards (with card images).
  - Shared decks list (publicly shared decks owned by this player).
  - Privacy-gated **Stats** section (shown if `canViewSection(statsVisibility, relation)`): total cards owned, distinct cards, packs opened, shared decks count.
  - Privacy-gated **Wishlist** section (shown if `canViewSection(wishlistVisibility, relation)`): cards they are looking for, with a note/hint if you own copies to trade.
  - Link to `/players/[id]/real` if they share their real collection.
- **`/account/profile` (Edit Profile)**:
  - Linked from `/account` and from your own `/players/[id]` page.
  - Form for bio, favorite colors, favorite formats, showcase deck selector (your shared decks), showcase card picker (up to 3), and privacy settings (`statsVisibility`, `wishlistVisibility`).
- **`/activity` (Activity feed filter)**:
  - Toggle tabs: `Everyone` | `Friends` (`?scope=friends`).
  - `activityFeed(db, limit, { actorId, scope })` filters `activity_events.actor_id` to accepted friends + self when `scope === "friends"`.

## 10. Events emitted

None — friend requests and profile edits are personal/social state and do not clutter the Magic activity feed.

## 11. Patterns applied

- **Modular monolith (ADR 0001) & Factory DI (ADR 0002):** `makeSocial(deps)` wired in `src/server/core.ts`.
- **Result types (ADR 0003):** all use cases return `Result<T, E>` for expected failures.
- **Unit of Work (ADR 0005):** write use cases run inside `uow.withTransaction(...)`.
- **CQRS-lite (ADR 0006):** read models in `src/modules/social/queries/` query Postgres directly and return plain view objects.
- **Injected Clock (ADR 0008):** timestamps come from `Clock.now()`.
- **Lint-enforced boundaries (ADR 0009):** `src/modules/social/index.ts` is the sole public API; `domain/` stays pure.

## 12. Test plan

- **Domain unit/property tests:** `checkBio`, `checkShowcaseCards`, `canViewSection`, `viewerRelation` across all combinations.
- **Use-case tests (fakes):** `updateProfile`, `sendFriendRequest` (self, duplicate, reverse pending, disabled), `acceptFriendRequest`, `declineFriendRequest`, `cancelFriendRequest`, `unfriend`.
- **Integration tests (`*.int.test.ts`):** Drizzle `ProfileRepository` & `FriendshipRepository` against real Postgres, verifying the unordered-pair unique constraint and `activityFeed` friends filter.
- **Verification:** `pnpm check` and `pnpm test:int`.

## 13. Decisions (from review)

1. **Profile URL:** `/players/[username]` is the primary URL used in links, and `/players/[id]` resolves either `username` (case-insensitive) or `userId` so both work seamlessly (compatible with `/players/[id]/real`).
2. **Default privacy:** `statsVisibility` defaults to `"everyone"`, `wishlistVisibility` defaults to `"friends"`.
3. **Activity feed (`Friends`):** Includes your own events alongside your accepted friends' events.
