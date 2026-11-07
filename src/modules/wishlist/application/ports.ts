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
  count(userId: UserId): Promise<number>;
  insert(wish: NewWish): Promise<Wish>;
  /** Saves new details for an existing wish. */
  update(wishId: WishId, details: WishDetails): Promise<void>;
  delete(wishId: WishId): Promise<void>;
  /** Deletes every wish of a player (a reset). Returns how many. */
  deleteAllOf(userId: UserId): Promise<number>;
}

/** What a printing is: its card and the finishes it was made in. */
export type PrintingFacts = Readonly<{ oracleId: string; finishes: readonly Finish[] }>;

/** Reads the catalog's and the collection's tables (CQRS-lite: their tables, not their code). */
export interface WishCatalog {
  /** Null for an unknown printing. */
  printing(printingId: string): Promise<PrintingFacts | null>;
  /** Every printing of this card for sale today, in every finish. */
  forSale(oracleId: string): Promise<Offer[]>;
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
