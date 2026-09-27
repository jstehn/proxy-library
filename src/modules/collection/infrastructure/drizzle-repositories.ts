import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { CollectionRepository } from "../application/ports";
import type { Acquisition, CardGain } from "../domain/cards";
import { acquisitions, collectionCards } from "./schema";

export function drizzleCollectionRepository(db: DbExecutor): CollectionRepository {
  async function receive(
    userId: UserId,
    gains: readonly CardGain[],
    acquisition: Acquisition,
  ): Promise<void> {
    const rows = gains.map((gain) => ({
      userId,
      printingId: gain.printingId,
      finish: gain.finish,
      quantity: gain.quantity,
    }));
    // Add to existing stacks: "on conflict" turns the insert into quantity = quantity + n.
    await db
      .insert(collectionCards)
      .values(rows)
      .onConflictDoUpdate({
        target: [collectionCards.userId, collectionCards.printingId, collectionCards.finish],
        set: { quantity: sql`${collectionCards.quantity} + excluded.quantity` },
      });
    await db.insert(acquisitions).values(
      rows.map((row) => ({
        ...row,
        source: acquisition.source,
        ref: acquisition.ref,
        createdAt: acquisition.at,
      })),
    );
  }

  return { receive };
}
