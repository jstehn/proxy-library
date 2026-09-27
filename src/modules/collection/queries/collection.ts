import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { acquisitions, collectionCards } from "../infrastructure/schema";

// Read models for the collection screens (ADR 0006).

export type OwnedCard = Readonly<{
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
  /** When the newest copy arrived, as an ISO string. */
  lastAcquiredAt: string;
}>;

/** Everything a player owns, newest arrivals first. */
export async function collectionFor(db: DbExecutor, userId: UserId): Promise<OwnedCard[]> {
  const rows = await db
    .select({
      printingId: collectionCards.printingId,
      finish: collectionCards.finish,
      quantity: collectionCards.quantity,
      lastAcquiredAt: sql<string>`max(${acquisitions.createdAt})`,
    })
    .from(collectionCards)
    .leftJoin(
      acquisitions,
      and(
        eq(acquisitions.userId, collectionCards.userId),
        eq(acquisitions.printingId, collectionCards.printingId),
        eq(acquisitions.finish, collectionCards.finish),
      ),
    )
    .where(eq(collectionCards.userId, userId))
    .groupBy(collectionCards.userId, collectionCards.printingId, collectionCards.finish)
    .orderBy(desc(sql`max(${acquisitions.createdAt})`));

  return rows.map((row) => ({
    printingId: row.printingId,
    // The database only allows these three (a CHECK constraint).
    finish: row.finish as OwnedCard["finish"],
    quantity: row.quantity,
    lastAcquiredAt: new Date(row.lastAcquiredAt).toISOString(),
  }));
}
