import { and, eq, gt, lt } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type { PreviewRepository } from "../application/ports";
import { deckChangePreviews } from "./schema";

export function drizzleChangePreviewRepository(db: DbExecutor): PreviewRepository {
  return {
    async store(record) {
      await db.insert(deckChangePreviews).values({
        id: record.id,
        userId: record.userId,
        deckId: record.deckId,
        fingerprint: record.fingerprint,
        changes: [...record.changes],
        expiresAt: record.expiresAt,
      });
    },

    async find(id, userId, now) {
      const [row] = await db
        .select()
        .from(deckChangePreviews)
        .where(
          and(
            eq(deckChangePreviews.id, id),
            eq(deckChangePreviews.userId, userId),
            gt(deckChangePreviews.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        userId: UserId.of(row.userId),
        deckId: row.deckId,
        fingerprint: row.fingerprint,
        changes: row.changes,
        expiresAt: row.expiresAt,
      };
    },

    async delete(id) {
      await db.delete(deckChangePreviews).where(eq(deckChangePreviews.id, id));
    },

    async prune(now) {
      await db.delete(deckChangePreviews).where(lt(deckChangePreviews.expiresAt, now));
    },
  };
}
