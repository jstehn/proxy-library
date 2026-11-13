import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { PrintingId } from "@/modules/catalog";
import { printings } from "@/modules/catalog/infrastructure/schema";
import { DeckId, type Format } from "@/modules/decks";
import { decks } from "@/modules/decks/infrastructure/schema";
import { players } from "@/modules/accounts/infrastructure/schema";
import type { DbExecutor } from "@/shared/db";
import { UserId, type ManaColor } from "@/shared/kernel";
import type {
  FriendshipRepository,
  PlayerLookup,
  ProfileRepository,
  ShowcaseValidator,
} from "../application/ports";
import type { Friendship, FriendshipStatus } from "../domain/friendship";
import type { PlayerProfile, SectionVisibility } from "../domain/profile";
import { friendships, playerProfiles } from "./schema";

export function drizzleProfileRepository(db: DbExecutor): ProfileRepository {
  return {
    async findByUserId(userId) {
      const [row] = await db
        .select()
        .from(playerProfiles)
        .where(eq(playerProfiles.userId, userId))
        .limit(1);
      if (!row) return null;
      return {
        userId: UserId.of(row.userId),
        bio: row.bio,
        favoriteColors: row.favoriteColors as ManaColor[],
        favoriteFormats: row.favoriteFormats as Format[],
        showcaseDeckId: row.showcaseDeckId === null ? null : DeckId.of(row.showcaseDeckId),
        showcasePrintingIds: row.showcasePrintingIds.map(PrintingId.of),
        statsVisibility: row.statsVisibility as SectionVisibility,
        wishlistVisibility: row.wishlistVisibility as SectionVisibility,
        updatedAt: row.updatedAt,
      };
    },
    async save(profile: PlayerProfile) {
      await db
        .insert(playerProfiles)
        .values({
          userId: profile.userId,
          bio: profile.bio,
          favoriteColors: [...profile.favoriteColors],
          favoriteFormats: [...profile.favoriteFormats],
          showcaseDeckId: profile.showcaseDeckId,
          showcasePrintingIds: [...profile.showcasePrintingIds],
          statsVisibility: profile.statsVisibility,
          wishlistVisibility: profile.wishlistVisibility,
          updatedAt: profile.updatedAt,
        })
        .onConflictDoUpdate({
          target: playerProfiles.userId,
          set: {
            bio: profile.bio,
            favoriteColors: [...profile.favoriteColors],
            favoriteFormats: [...profile.favoriteFormats],
            showcaseDeckId: profile.showcaseDeckId,
            showcasePrintingIds: [...profile.showcasePrintingIds],
            statsVisibility: profile.statsVisibility,
            wishlistVisibility: profile.wishlistVisibility,
            updatedAt: profile.updatedAt,
          },
        });
    },
  };
}

export function drizzleFriendshipRepository(db: DbExecutor): FriendshipRepository {
  return {
    async findBetween(a, b): Promise<Friendship | null> {
      const [row] = await db
        .select()
        .from(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
            and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        requesterId: UserId.of(row.requesterId),
        addresseeId: UserId.of(row.addresseeId),
        status: row.status as FriendshipStatus,
        createdAt: row.createdAt,
        acceptedAt: row.acceptedAt,
      };
    },
    async insert(friendship) {
      await db.insert(friendships).values({
        requesterId: friendship.requesterId,
        addresseeId: friendship.addresseeId,
        status: friendship.status,
        createdAt: friendship.createdAt,
        acceptedAt: friendship.acceptedAt,
      });
    },
    async markAccepted(requesterId, addresseeId, acceptedAt) {
      await db
        .update(friendships)
        .set({ status: "accepted", acceptedAt })
        .where(
          and(eq(friendships.requesterId, requesterId), eq(friendships.addresseeId, addresseeId)),
        );
    },
    async deleteBetween(a, b) {
      await db
        .delete(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
            and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
          ),
        );
    },
  };
}

export function drizzleSocialPlayerLookup(db: DbExecutor): PlayerLookup {
  return {
    async isActivePlayer(userId) {
      const [row] = await db
        .select({ userId: players.userId })
        .from(players)
        .where(and(eq(players.userId, userId), isNull(players.disabledAt)))
        .limit(1);
      return row !== undefined;
    },
  };
}

export function drizzleShowcaseValidator(db: DbExecutor): ShowcaseValidator {
  return {
    async isOwnedSharedDeck(ownerId, deckId) {
      const [row] = await db
        .select({ id: decks.id })
        .from(decks)
        .where(
          and(eq(decks.id, deckId), eq(decks.ownerId, ownerId), eq(decks.visibility, "shared")),
        )
        .limit(1);
      return row !== undefined;
    },
    async allPrintingsExist(printingIds) {
      if (printingIds.length === 0) return true;
      const rows = await db
        .select({ id: printings.id })
        .from(printings)
        .where(inArray(printings.id, [...printingIds]));
      return rows.length === printingIds.length;
    },
  };
}
