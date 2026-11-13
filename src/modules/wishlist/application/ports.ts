import type { Finish } from "@/modules/catalog";
import type { StoreServices } from "@/modules/store";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { Offer } from "../domain/lines";
import type { OwnedStack, Wish, WishDetails, WishId, WishTarget } from "../domain/wish";

// Ports: what the wishlist's use cases need from outside (design doc 26, section 6). Real
// versions in ../infrastructure, fakes in ../testing.

/** A wish about to be saved: everything but its id. */
export type NewWish = Omit<Wish, "id">;

export interface WishRepository {
  /** Holds this player's wishlist until the transaction ends, so two tabs can't add at once. */
  lock(userId: UserId): Promise<void>;
  /** The wish, if it exists and belongs to this player (rule 5). */
  find(wishId: WishId, userId: UserId): Promise<Wish | null>;
  /** The player's wish for this target, if they have one (rule 1). */
  findByTarget(userId: UserId, target: WishTarget): Promise<Wish | null>;
  /** The player's wishes for any of these cards, every kind of target. */
  forCards(userId: UserId, oracleIds: readonly string[]): Promise<Wish[]>;
  count(userId: UserId): Promise<number>;
  insert(wish: NewWish): Promise<Wish>;
  /** Saves new details for an existing wish. */
  update(wishId: WishId, details: WishDetails): Promise<void>;
  delete(wishId: WishId): Promise<void>;
  /** Deletes every wish of a player (a reset). Returns how many. */
  deleteAllOf(userId: UserId): Promise<number>;
  /** Sets whether the playgroup can see this player's wishlist (design doc 50). */
  setSharing(userId: UserId, isShared: boolean, at: Date): Promise<void>;
}

/** What a printing is: its card and the finishes it was made in. */
export type PrintingFacts = Readonly<{ oracleId: string; finishes: readonly Finish[] }>;

/** Reads the catalog's and the collection's tables (CQRS-lite: their tables, not their code). */
export interface WishCatalog {
  /** Null for an unknown printing. */
  printing(printingId: string): Promise<PrintingFacts | null>;
  /** Which of these cards (oracle ids) the catalog has. */
  knownCards(oracleIds: readonly string[]): Promise<Set<string>>;
  /** Every printing of this card for sale today, in every finish. */
  forSale(oracleId: string): Promise<Offer[]>;
  /** The same for many cards at once, in one query. */
  forSaleOfCards(oracleIds: readonly string[]): Promise<Offer[]>;
  /** What the player owns of this card, every printing and finish. */
  owned(userId: UserId, oracleId: string): Promise<OwnedStack[]>;
}

export type WishlistServices = {
  wishes: WishRepository;
  wishCatalog: WishCatalog;
};

export type WishlistDependencies = {
  /** Buying from the wishlist is the store's purchase, in the same transaction (rule 6). */
  unitOfWork: UnitOfWork<WishlistServices & StoreServices>;
  clock: Clock;
};
