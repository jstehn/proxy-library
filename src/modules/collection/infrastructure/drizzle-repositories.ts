import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { CollectionRepository } from "../application/ports";
import type { Acquisition, CardGain } from "../domain/cards";
import type { NotEnoughCopies } from "../domain/errors";
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

  async function remove(
    userId: UserId,
    losses: readonly CardGain[],
    acquisition: Acquisition,
  ): Promise<Result<void, NotEnoughCopies>> {
    // Lock this player's rows for these printings, so two sales of the last copy can't both pass.
    const rows = await db
      .select()
      .from(collectionCards)
      .where(
        and(
          eq(collectionCards.userId, userId),
          inArray(
            collectionCards.printingId,
            losses.map((loss) => loss.printingId),
          ),
        ),
      )
      .for("update");
    const owned = (loss: CardGain) =>
      rows.find((row) => row.printingId === loss.printingId && row.finish === loss.finish)
        ?.quantity ?? 0;

    for (const loss of losses) {
      if (owned(loss) < loss.quantity) {
        return err({
          kind: "NotEnoughCopies",
          printingId: loss.printingId,
          finish: loss.finish,
          owned: owned(loss),
          needed: loss.quantity,
        });
      }
    }

    for (const loss of losses) {
      const where = and(
        eq(collectionCards.userId, userId),
        eq(collectionCards.printingId, loss.printingId),
        eq(collectionCards.finish, loss.finish),
      );
      if (owned(loss) === loss.quantity) {
        await db.delete(collectionCards).where(where); // no rows at zero (the CHECK needs > 0)
      } else {
        await db
          .update(collectionCards)
          .set({ quantity: sql`${collectionCards.quantity} - ${loss.quantity}` })
          .where(where);
      }
    }
    await db.insert(acquisitions).values(
      losses.map((loss) => ({
        userId,
        printingId: loss.printingId,
        finish: loss.finish,
        quantity: -loss.quantity,
        source: acquisition.source,
        ref: acquisition.ref,
        createdAt: acquisition.at,
      })),
    );
    return ok();
  }

  return { receive, remove };
}
