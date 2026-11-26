import { and, eq, inArray, sql } from "drizzle-orm";
import { PrintingId } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { CardGainBatch, CollectionRepository } from "../application/ports";
import { combineGains, type Acquisition, type CardGain } from "../domain/cards";
import type { NotEnoughCopies } from "../domain/errors";
import { acquisitions, collectionCards } from "./schema";

export function drizzleCollectionRepository(db: DbExecutor): CollectionRepository {
  async function receiveBatch(userId: UserId, batches: readonly CardGainBatch[]): Promise<void> {
    if (batches.length === 0) return;
    const combined = combineGains(batches.flatMap((batch) => batch.gains));
    if (combined.length > 0) {
      await db
        .insert(collectionCards)
        .values(
          combined.map((gain) => ({
            userId,
            printingId: gain.printingId,
            finish: gain.finish,
            quantity: gain.quantity,
          })),
        )
        .onConflictDoUpdate({
          target: [collectionCards.userId, collectionCards.printingId, collectionCards.finish],
          set: { quantity: sql`${collectionCards.quantity} + excluded.quantity` },
        });
    }
    const acquisitionRows = batches.flatMap((batch) =>
      batch.gains.map((gain) => ({
        userId,
        printingId: gain.printingId,
        finish: gain.finish,
        quantity: gain.quantity,
        source: batch.acquisition.source,
        ref: batch.acquisition.ref,
        createdAt: batch.acquisition.at,
      })),
    );
    if (acquisitionRows.length > 0) {
      await db.insert(acquisitions).values(acquisitionRows);
    }
  }

  async function receive(
    userId: UserId,
    gains: readonly CardGain[],
    acquisition: Acquisition,
  ): Promise<void> {
    await receiveBatch(userId, [{ gains, acquisition }]);
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

    const toDelete = losses.filter((loss) => owned(loss) === loss.quantity);
    const toUpdate = losses.filter((loss) => owned(loss) > loss.quantity);

    if (toDelete.length > 0) {
      // No rows at zero (the CHECK needs > 0).
      const printingIds = toDelete.map((loss) => loss.printingId);
      const finishes = toDelete.map((loss) => loss.finish);
      await db.execute(sql`
        delete from collection_cards
         where user_id = ${userId}
           and (printing_id, finish) in (
             select * from unnest(${sql.param(printingIds)}::text[], ${sql.param(finishes)}::text[])
           )
      `);
    }
    if (toUpdate.length > 0) {
      const printingIds = toUpdate.map((loss) => loss.printingId);
      const finishes = toUpdate.map((loss) => loss.finish);
      const amounts = toUpdate.map((loss) => loss.quantity);
      await db.execute(sql`
        update collection_cards c
           set quantity = c.quantity - v.amount
          from unnest(
                 ${sql.param(printingIds)}::text[],
                 ${sql.param(finishes)}::text[],
                 ${sql.param(amounts)}::int[]
               ) as v(printing_id, finish, amount)
         where c.user_id = ${userId}
           and c.printing_id = v.printing_id
           and c.finish = v.finish
      `);
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

  async function everything(userId: UserId): Promise<CardGain[]> {
    const rows = await db
      .select()
      .from(collectionCards)
      .where(eq(collectionCards.userId, userId))
      .for("update");
    return rows.map((row) => ({
      printingId: PrintingId.of(row.printingId),
      // The database only allows these three (a CHECK constraint).
      finish: row.finish as CardGain["finish"],
      quantity: row.quantity,
    }));
  }

  return { receive, receiveBatch, remove, everything };
}
