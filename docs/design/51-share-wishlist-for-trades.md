# Design: Share a wishlist with the playgroup for trades

- **Phase:** 50 (Roadmap #72)
- **Status:** **Approved** (2026-11-12)
- **Related ADRs:** 0001, 0009, 0016, 0023
- **Lesson:** no

## 1. Purpose & scope

Let a player share their wishlist with the rest of the playgroup so trading partners can see what cards they are looking for—both on a read-only player wishlist page and directly when browsing/building trades.

**Out of scope:**

- Public (unauthenticated) wishlist links.
- Automatically creating or matching trades from wishlists.
- Exposing a player's wallet balance, paydays, or private wish notes (see Open Questions on notes).

## 2. Ubiquitous language

| Term            | Meaning in this codebase                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| Shared wishlist | A player's wishlist when `wishlist_settings.is_shared = true`, readable by any signed-in player in the group. |

## 3. Domain model

Follows the same pattern as `real_collection_settings` (design doc 16):

- Sharing is a per-player boolean preference (`isShared`, default `false`).
- Reading another player's wishlist is allowed only when `isShared === true` (or `viewerId === ownerId`). Non-shared wishlists return `null` / `notFound()`, never "forbidden", so the page does not leak whether a player has wishes.

## 4. Invariants

1. **Private by default:** A player's wishlist is not visible to anyone else until they opt in (`isShared = true`).
2. **Owner-only toggle:** Only the player themselves may enable or disable sharing of their wishlist.
3. **No financial leakage:** Shared wishlist views never show the owner's wallet balance, allowance, payday countdown, or `targetCents` / `savedCents` (unless explicitly desired—only card, printing/finish preference, and quantity are needed for trading).

## 5. Use cases

In `makeWishlist` (`src/modules/wishlist/application/make-wishlist.ts`):

| Use case     | Actor / authz    | Input                   | Output | Errors (`kind`) | Transaction? |
| ------------ | ---------------- | ----------------------- | ------ | --------------- | ------------ |
| `setSharing` | Signed-in player | `{ isShared: boolean }` | `void` | none            | Yes          |

## 6. Ports

Extend `WishRepository` (`src/modules/wishlist/application/ports.ts`):

```ts
setSharing(userId: UserId, isShared: boolean, at: Date): Promise<void>;
```

## 7. Persistence

In `src/modules/wishlist/infrastructure/schema.ts`:

```ts
/** A player's choices about their wishlist. No row means the defaults (not shared). */
export const wishlistSettings = pgTable("wishlist_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => players.userId, { onDelete: "cascade" }),
  isShared: boolean("is_shared").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
```

- Generate and apply the Drizzle migration (`pnpm db:generate && pnpm db:migrate`).

## 8. Read models (queries)

In `src/modules/wishlist/queries/wishlist.ts`:

- `isWishlistShared(db, userId)` → `Promise<boolean>`
- `sharedWishlists(db)` → `Promise<Array<{ userId: string; displayName: string; count: number }>>` — all players with `isShared = true` (similar to `sharedRealCollections`).
- `sharedWishlistFor(db, viewerId, ownerId)` → `Promise<{ ownerName: string; lines: SharedWishLine[] } | null>` — returns `null` if `ownerId` has not shared their wishlist (and `viewerId !== ownerId`). Each `SharedWishLine` includes `id`, `oracleId`, `cardName`, `printingId`, `setCode`, `collectorNumber`, `finish`, `quantity`, `marketCents`, and `viewerOwnedCount` (how many copies the viewer owns in their game collection, so you immediately know what you can offer!).

## 9. UI

- **`src/app/wishlist/page.tsx`:**
  - Add a **"Share with the playgroup"** / **"Stop sharing"** toggle form (`setWishlistSharingAction`), matching the pattern in `/collection/real`.
  - List links to other players' shared wishlists when any exist.
- **`src/app/players/[id]/wishlist/page.tsx`:**
  - Read-only page showing the player's shared wishlist (`sharedWishlistFor`), highlighting cards the viewer owns in their game collection with a quick link to `/trades/new?with=${ownerId}` (and optionally pre-filling the card!).
- **`src/app/trades/page.tsx` & `src/app/trades/new/page.tsx`:**
  - On `/trades`, show a link to `{other.displayName}'s wishlist` next to `{other.displayName}'s real collection` when `sharingWishlist.has(other.userId)`.
  - On `/trades/new`, when a partner is selected and has a shared wishlist, show a compact **"Cards {partner} wants"** panel (highlighting ones you own) with `+ add` buttons to add them straight to the `give` side of the trade draft.

## 10. Test plan

- **Use-case tests (`wishlist.test.ts`):** `setSharing` toggles sharing on and off.
- **Integration tests (`tests/integration/wishlist.int.test.ts`):** `isWishlistShared`, `sharedWishlists`, and `sharedWishlistFor` enforce privacy when `isShared = false` and return expected lines + `viewerOwnedCount` when `isShared = true`.
- **Full check:** `pnpm check`.

## 11. Decisions

1. **Wish notes:** Visible on the shared wishlist (so trading partners see context like _"need for my Atraxa deck"_).
2. **Target price:** `targetCents` is hidden on shared views (personal budget limit).
3. **Trades integration:** `/trades/new` shows a **"Cards {partner} wants"** panel when the partner shares their wishlist, highlighting copies you own with one-click `+ add` to the `give` side, alongside the link from `/trades` to `/players/[id]/wishlist`.
