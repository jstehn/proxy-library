import { and, desc, eq, sql } from "drizzle-orm";
import { textArray, type DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { WishlistAnswers } from "../domain/lines";
import { wishFromStored, type Wish } from "../domain/wish";
import { wishes } from "../infrastructure/schema";
import { offersOf, ownedOf } from "./for-sale";

// The wishlist reads that take a plain `UserId`. They are NOT public reads (not in
// `queries/index.ts`, so `reads` never offers them): the public ones in `wishlist.ts` call them
// with the actor's id, and capabilities that already hold the player's id use them directly
// (design doc 67, section 7B).

/** What a list of wishes would buy: what's for sale of them and what the player owns. */
export async function answersFor(
  db: DbExecutor,
  userId: UserId,
  wished: readonly Wish[],
): Promise<WishlistAnswers> {
  const oracleIds = [...new Set(wished.map((wish) => wish.target.oracleId))];
  if (oracleIds.length === 0) return { wishes: [], names: new Map(), forSale: [], owned: [] };
  const [forSale, owned, names] = await Promise.all([
    offersOf(db, oracleIds),
    ownedOf(db, userId, oracleIds),
    db.execute<{ oracle_id: string; name: string }>(sql`
      select distinct on (oracle_id) oracle_id, name from printings
       where oracle_id = any(${textArray(oracleIds)})
    `),
  ]);
  return {
    wishes: wished,
    names: new Map(names.rows.map((row) => [row.oracle_id, row.name])),
    forSale,
    owned,
  };
}

/** Everything the Wishlist page needs, for the player with this id. */
export async function wishlistAnswersOf(db: DbExecutor, userId: UserId): Promise<WishlistAnswers> {
  const rows = await db
    .select()
    .from(wishes)
    .where(eq(wishes.userId, userId))
    .orderBy(desc(wishes.createdAt));
  return answersFor(db, userId, rows.map(wishFromStored));
}

/** The player's wishes for the card this printing is (any kind). */
export async function wishesForCardOf(
  db: DbExecutor,
  userId: UserId,
  printingId: string,
): Promise<Wish[]> {
  const rows = await db
    .select({ wish: wishes })
    .from(wishes)
    .where(
      and(
        eq(wishes.userId, userId),
        sql`${wishes.oracleId} = (select oracle_id from printings where id = ${printingId})`,
      ),
    )
    .orderBy(wishes.createdAt);
  return rows.map((row) => wishFromStored(row.wish));
}
