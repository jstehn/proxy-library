import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { authUsers } from "../../accounts/infrastructure/schema";
import { printings } from "../../catalog/infrastructure/schema";
import { countAtTarget, type WishlistAnswers } from "../domain/lines";
import { wishFromStored, type FinishPreference, type OwnedStack, type Wish } from "../domain/wish";
import { wishes, wishlistSettings } from "../infrastructure/schema";
import { offersOf, ownedOf, textArray } from "./for-sale";

type Finish = OwnedStack["finish"];

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

/** Whether this player lets the playgroup see their wishlist (design doc 50). */
export async function isWishlistShared(db: DbExecutor, userId: UserId): Promise<boolean> {
  const [row] = await db
    .select({ isShared: wishlistSettings.isShared })
    .from(wishlistSettings)
    .where(eq(wishlistSettings.userId, userId));
  return row?.isShared ?? false;
}

export type SharedWishlistSummary = Readonly<{
  userId: string;
  displayName: string;
  count: number;
}>;

/** Every player who has opted into sharing their wishlist, with how many wishes they have. */
export async function sharedWishlists(db: DbExecutor): Promise<SharedWishlistSummary[]> {
  const result = await db.execute<{ user_id: string; display_name: string; count: number }>(sql`
    select s.user_id, u.name as display_name, count(w.id)::int as count
      from wishlist_settings s
      join auth_users u on u.id = s.user_id
      left join wishes w on w.user_id = s.user_id
     where s.is_shared
     group by s.user_id, u.name
     order by u.name
  `);
  return result.rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    count: Number(row.count),
  }));
}

export type SharedWishCopy = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
}>;

export type SharedWishLine = Readonly<{
  id: number;
  oracleId: string;
  cardName: string;
  printingId: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  finish: Finish | FinishPreference;
  quantity: number;
  note: string;
  /** Copies of this wish's target that the viewer owns in their game collection. */
  viewerOwned: readonly SharedWishCopy[];
}>;

export type SharedWishlist = Readonly<{
  ownerName: string;
  lines: readonly SharedWishLine[];
}>;

/**
 * Another player's shared wishlist, or null if they haven't shared it (design doc 50). Never
 * exposes targetCents, wallet balance, or paydays.
 */
export async function sharedWishlistFor(
  db: DbExecutor,
  viewerId: UserId,
  ownerId: UserId,
): Promise<SharedWishlist | null> {
  const [owner] = await db
    .select({ name: authUsers.name, isShared: wishlistSettings.isShared })
    .from(authUsers)
    .leftJoin(wishlistSettings, eq(wishlistSettings.userId, authUsers.id))
    .where(eq(authUsers.id, ownerId));
  if (owner === undefined) return null;
  if (viewerId !== ownerId && !owner.isShared) return null;

  const rows = await db
    .select()
    .from(wishes)
    .where(eq(wishes.userId, ownerId))
    .orderBy(desc(wishes.createdAt));
  if (rows.length === 0) return { ownerName: owner.name, lines: [] };

  const wished = rows.map(wishFromStored);
  const oracleIds = [...new Set(wished.map((wish) => wish.target.oracleId))];
  const exactIds = [
    ...new Set(
      wished.flatMap((wish) =>
        wish.target.kind === "exactPrinting" ? [wish.target.printingId] : [],
      ),
    ),
  ];

  const [owned, names, exactPrintings] = await Promise.all([
    ownedOf(db, viewerId, oracleIds),
    db.execute<{ oracle_id: string; name: string }>(sql`
      select distinct on (oracle_id) oracle_id, name from printings
       where oracle_id = any(${textArray(oracleIds)})
    `),
    exactIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: printings.id,
            setCode: printings.setCode,
            collectorNumber: printings.collectorNumber,
          })
          .from(printings)
          .where(sql`${printings.id} = any(${textArray(exactIds)})`),
  ]);

  const nameByOracle = new Map(names.rows.map((row) => [row.oracle_id, row.name]));
  const printingById = new Map(exactPrintings.map((row) => [row.id, row]));

  const lines: SharedWishLine[] = wished.map((wish) => {
    const { target } = wish;
    const printing = target.kind === "exactPrinting" ? printingById.get(target.printingId) : null;
    const viewerOwned = owned
      .filter((stack) => {
        if (stack.oracleId !== target.oracleId) return false;
        if (target.kind === "exactPrinting") {
          return stack.printingId === target.printingId && stack.finish === target.finish;
        }
        return target.finish === "cheapest" || stack.finish === target.finish;
      })
      .map((stack) => ({
        printingId: stack.printingId,
        finish: stack.finish,
        quantity: stack.quantity,
      }));
    return {
      id: wish.id,
      oracleId: target.oracleId,
      cardName: nameByOracle.get(target.oracleId) ?? "Unknown card",
      printingId: target.kind === "exactPrinting" ? target.printingId : null,
      setCode: printing?.setCode ?? null,
      collectorNumber: printing?.collectorNumber ?? null,
      finish: target.finish,
      quantity: wish.quantity,
      note: wish.note,
      viewerOwned,
    };
  });

  return { ownerName: owner.name, lines };
}
