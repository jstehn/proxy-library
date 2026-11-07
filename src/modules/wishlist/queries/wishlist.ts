import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { countAtTarget, type WishlistAnswers } from "../domain/lines";
import { wishFromStored, type Wish } from "../domain/wish";
import { wishes } from "../infrastructure/schema";
import { offersOf, ownedOf, textArray } from "./for-sale";

// Read models for the wishlist (design doc 26, section 9). The queries gather rows; the
// domain's `wishLines` decides what each wish would buy and what it costs.

async function answersFor(
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

/** Everything the Wishlist page needs: the wishes, what's for sale of them, what you own. */
export async function wishlistAnswers(db: DbExecutor, userId: UserId): Promise<WishlistAnswers> {
  const rows = await db
    .select()
    .from(wishes)
    .where(eq(wishes.userId, userId))
    .orderBy(desc(wishes.createdAt));
  return answersFor(db, userId, rows.map(wishFromStored));
}

/** The header badge: wishes at or under their target price. Only wishes with a target count. */
export async function wishesAtTarget(db: DbExecutor, userId: UserId): Promise<number> {
  const rows = await db
    .select()
    .from(wishes)
    .where(and(eq(wishes.userId, userId), isNotNull(wishes.targetCents)));
  if (rows.length === 0) return 0;
  return countAtTarget(await answersFor(db, userId, rows.map(wishFromStored)));
}

/** Your wishes for the card this printing is (any kind), for the card page. */
export async function wishesForCard(
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

/** Which of these printings are of a card on your wishlist (the ★ in the Singles grid). */
export async function wishedPrintings(
  db: DbExecutor,
  userId: UserId,
  printingIds: readonly string[],
): Promise<Set<string>> {
  if (printingIds.length === 0) return new Set();
  const result = await db.execute<{ id: string }>(sql`
    select p.id from printings p
     where p.id = any(${textArray(printingIds)})
       and exists (select 1 from wishes w where w.user_id = ${userId} and w.oracle_id = p.oracle_id)
  `);
  return new Set(result.rows.map((row) => row.id));
}
