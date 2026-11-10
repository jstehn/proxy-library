import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { FINISHES } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { WishCatalog, WishRepository } from "../application/ports";
import { wishFromStored, type WishTarget } from "../domain/wish";
import { offersOf, ownedOf } from "../queries/for-sale";
import { printings } from "../../catalog/infrastructure/schema";
import { wishes } from "./schema";

// Real implementations of the wishlist's ports (design doc 26, sections 6 and 8).

export function drizzleWishRepository(db: DbExecutor): WishRepository {
  /** The columns that say which wish this is (rule 1's unique indexes). */
  function targetCondition(userId: UserId, target: WishTarget) {
    return target.kind === "anyPrinting"
      ? and(
          eq(wishes.userId, userId),
          isNull(wishes.printingId),
          eq(wishes.oracleId, target.oracleId),
          eq(wishes.finish, target.finish),
        )
      : and(
          eq(wishes.userId, userId),
          eq(wishes.printingId, target.printingId),
          eq(wishes.finish, target.finish),
        );
  }

  const repository: WishRepository = {
    async lock(userId) {
      // A lock on the player's wishlist rather than on rows: it also covers wishes not yet
      // added. Released when the transaction ends.
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`wishlist:${userId}`}))`);
    },

    async find(wishId, userId) {
      const [row] = await db
        .select()
        .from(wishes)
        .where(and(eq(wishes.id, wishId), eq(wishes.userId, userId)));
      return row === undefined ? null : wishFromStored(row);
    },

    async findByTarget(userId, target) {
      const [row] = await db.select().from(wishes).where(targetCondition(userId, target));
      return row === undefined ? null : wishFromStored(row);
    },

    async forCards(userId, oracleIds) {
      if (oracleIds.length === 0) return [];
      const rows = await db
        .select()
        .from(wishes)
        .where(and(eq(wishes.userId, userId), inArray(wishes.oracleId, [...oracleIds])));
      return rows.map(wishFromStored);
    },

    async count(userId) {
      const [row] = await db
        .select({ total: sql`count(*)`.mapWith(Number) })
        .from(wishes)
        .where(eq(wishes.userId, userId));
      return row.total;
    },

    async insert(wish) {
      const [row] = await db
        .insert(wishes)
        .values({
          userId: wish.userId,
          oracleId: wish.target.oracleId,
          printingId: wish.target.kind === "exactPrinting" ? wish.target.printingId : null,
          finish: wish.target.finish,
          quantity: wish.quantity,
          targetCents: wish.targetPrice,
          savedCents: wish.savedPrice,
          note: wish.note,
          createdAt: wish.createdAt,
        })
        .returning();
      return wishFromStored(row);
    },

    async update(wishId, details) {
      await db
        .update(wishes)
        .set({ quantity: details.quantity, targetCents: details.targetPrice, note: details.note })
        .where(eq(wishes.id, wishId));
    },

    async delete(wishId) {
      await db.delete(wishes).where(eq(wishes.id, wishId));
    },

    async deleteAllOf(userId) {
      const deleted = await db
        .delete(wishes)
        .where(eq(wishes.userId, userId))
        .returning({ id: wishes.id });
      return deleted.length;
    },
  };
  return repository;
}

export function drizzleWishCatalog(db: DbExecutor): WishCatalog {
  return {
    async printing(printingId) {
      const [row] = await db
        .select({ oracleId: printings.oracleId, finishes: printings.finishes })
        .from(printings)
        .where(eq(printings.id, printingId));
      if (row === undefined) return null;
      return {
        oracleId: row.oracleId,
        finishes: FINISHES.filter((finish) => row.finishes.includes(finish)),
      };
    },
    async knownCards(oracleIds) {
      if (oracleIds.length === 0) return new Set();
      const rows = await db
        .selectDistinct({ oracleId: printings.oracleId })
        .from(printings)
        .where(inArray(printings.oracleId, [...oracleIds]));
      return new Set(rows.map((row) => row.oracleId));
    },
    forSale: (oracleId) => offersOf(db, [oracleId]),
    forSaleOfCards: (oracleIds) => offersOf(db, oracleIds),
    owned: (userId, oracleId) => ownedOf(db, userId, [oracleId]),
  };
}
