import type { UserId } from "@/shared/kernel";
import type { PrintingFacts, WishCatalog, WishRepository } from "../application/ports";
import type { Offer } from "../domain/lines";
import { sameTarget, WishId, type OwnedStack, type Wish } from "../domain/wish";

// In-memory stand-ins for the wishlist's ports.

export function inMemoryWishRepository() {
  let rows: Wish[] = [];
  let lastId = 0;
  const repository: WishRepository = {
    async lock() {},
    async find(wishId, userId) {
      return rows.find((wish) => wish.id === wishId && wish.userId === userId) ?? null;
    },
    async findByTarget(userId, target) {
      return rows.find((wish) => wish.userId === userId && sameTarget(wish.target, target)) ?? null;
    },
    async count(userId) {
      return rows.filter((wish) => wish.userId === userId).length;
    },
    async insert(newWish) {
      const wish: Wish = { ...newWish, id: WishId.of(++lastId) };
      rows.push(wish);
      return wish;
    },
    async update(wishId, details) {
      rows = rows.map((wish) => (wish.id === wishId ? { ...wish, ...details } : wish));
    },
    async delete(wishId) {
      rows = rows.filter((wish) => wish.id !== wishId);
    },
    async deleteAllOf(userId) {
      const before = rows.length;
      rows = rows.filter((wish) => wish.userId !== userId);
      return before - rows.length;
    },
  };
  return { ...repository, all: () => rows };
}

/**
 * A catalog from tables. `owned` reads the player's copies through `ownedBy`, so a test can
 * point it at the fake collection that a purchase adds to.
 */
export function inMemoryWishCatalog(tables: {
  printings: Readonly<Record<string, PrintingFacts>>;
  forSale: readonly Offer[];
  ownedBy: (userId: UserId) => OwnedStack[];
}): WishCatalog {
  return {
    async printing(printingId) {
      return tables.printings[printingId] ?? null;
    },
    async forSale(oracleId) {
      return tables.forSale.filter((offer) => offer.oracleId === oracleId);
    },
    async owned(userId, oracleId) {
      return tables.ownedBy(userId).filter((stack) => stack.oracleId === oracleId);
    },
  };
}
