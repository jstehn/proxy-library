import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type { DeckSharingRepository } from "../application/ports";
import { DeckId } from "../domain/deck";
import { CommentId, VISIBILITIES } from "../domain/sharing";
import { deckComments, decks } from "./schema";

// Sharing decks and comments on them, in Postgres (design doc 21, section 8).

export function drizzleDeckSharing(db: DbExecutor): DeckSharingRepository {
  return {
    async lockDeck(deckId) {
      const [row] = (
        await db.execute<{
          id: number;
          owner_id: string;
          name: string;
          format: string;
          visibility: string;
          first_shared_at: Date | null;
        }>(sql`
          select id, owner_id, name, format, visibility, first_shared_at
            from decks where id = ${deckId} for update
        `)
      ).rows;
      if (row === undefined) return null;
      return {
        id: DeckId.of(Number(row.id)),
        ownerId: UserId.of(row.owner_id),
        name: row.name,
        format: row.format,
        visibility: z.enum(VISIBILITIES).parse(row.visibility),
        firstSharedAt: row.first_shared_at === null ? null : new Date(row.first_shared_at),
      };
    },

    async setVisibility(deckId, visibility, firstSharedAt) {
      await db.update(decks).set({ visibility, firstSharedAt }).where(eq(decks.id, deckId));
    },

    async addComment(input) {
      const [row] = await db
        .insert(deckComments)
        .values({
          deckId: input.deckId,
          authorId: input.authorId,
          body: input.body,
          createdAt: input.at,
        })
        .returning({ id: deckComments.id });
      return CommentId.of(row.id);
    },

    async lockComment(commentId) {
      const [row] = (
        await db.execute<{
          id: number;
          deck_id: number;
          author_id: string;
          deleted_at: Date | null;
          deck_owner_id: string;
        }>(sql`
          select c.id, c.deck_id, c.author_id, c.deleted_at, d.owner_id as deck_owner_id
            from deck_comments c join decks d on d.id = c.deck_id
           where c.id = ${commentId}
             for update of c
        `)
      ).rows;
      if (row === undefined) return null;
      return {
        id: CommentId.of(Number(row.id)),
        deckId: DeckId.of(Number(row.deck_id)),
        authorId: UserId.of(row.author_id),
        deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
        deckOwnerId: UserId.of(row.deck_owner_id),
      };
    },

    async markDeleted(commentId, deletedBy, at) {
      // The text goes; the row keeps its place in the thread (a soft delete).
      await db
        .update(deckComments)
        .set({ body: "", deletedAt: at, deletedBy })
        .where(eq(deckComments.id, commentId));
    },
  };
}
