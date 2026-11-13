import type { PrintingId } from "@/modules/catalog";
import type { DeckId } from "@/modules/decks";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { Friendship } from "../domain/friendship";
import type { PlayerProfile } from "../domain/profile";

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

export type SocialServices = {
  profiles: ProfileRepository;
  friendships: FriendshipRepository;
  socialPlayers: PlayerLookup;
  showcaseValidator: ShowcaseValidator;
};

export type SocialDependencies = {
  unitOfWork: UnitOfWork<SocialServices>;
  clock: Clock;
};
