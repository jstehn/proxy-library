import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type { GoldfishSessionRepository } from "../application/ports";
import { DeckId } from "../domain/deck";
import { goldfishSessions } from "./schema";

export function drizzleGoldfishSessionRepository(db: DbExecutor): GoldfishSessionRepository {
  return {
    async create(record) {
      await db.insert(goldfishSessions).values({
        id: record.id,
        userId: record.userId,
        deckId: record.deckId,
        state: record.state,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
      });
    },

    async findById(id, userId, now) {
      const [row] = await db
        .select()
        .from(goldfishSessions)
        .where(
          and(
            eq(goldfishSessions.id, id),
            eq(goldfishSessions.userId, userId),
            gt(goldfishSessions.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        userId: UserId.of(row.userId),
        deckId: DeckId.of(row.deckId),
        state: row.state,
        updatedAt: row.updatedAt,
        expiresAt: row.expiresAt,
      };
    },

    async save(id, userId, state, updatedAt, expiresAt) {
      await db
        .update(goldfishSessions)
        .set({ state, updatedAt, expiresAt })
        .where(and(eq(goldfishSessions.id, id), eq(goldfishSessions.userId, userId)));
    },

    async pruneExpired(now) {
      const deleted = await db
        .delete(goldfishSessions)
        .where(lt(goldfishSessions.expiresAt, now))
        .returning({ id: goldfishSessions.id });
      return deleted.length;
    },

    async enforceUserCap(userId, maxSessions) {
      const rows = await db
        .select({ id: goldfishSessions.id })
        .from(goldfishSessions)
        .where(eq(goldfishSessions.userId, userId))
        .orderBy(desc(goldfishSessions.updatedAt));
      const excess = rows.slice(Math.max(0, maxSessions)).map((r) => r.id);
      if (excess.length === 0) return 0;
      await db.delete(goldfishSessions).where(inArray(goldfishSessions.id, excess));
      return excess.length;
    },
  };
}
