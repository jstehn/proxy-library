import type { DeckId } from "@/modules/decks/core/client";
import type { UserId } from "@/shared/kernel";
import type { DeckSharingRepository } from "../application/ports";
import { CommentId, type DeckForSharing } from "../domain/sharing";

// In-memory stand-in for the sharing port.

type StoredComment = {
  id: CommentId;
  deckId: DeckId;
  authorId: UserId;
  body: string;
  deletedAt: Date | null;
  deletedBy: UserId | null;
};

/** Decks to share and their comments, in memory (design doc 21). */
export function inMemoryDeckSharing(decks: readonly DeckForSharing[]) {
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  const comments: StoredComment[] = [];

  const repository: DeckSharingRepository = {
    async lockDeck(deckId) {
      return byId.get(deckId) ?? null;
    },
    async setVisibility(deckId, visibility, firstSharedAt) {
      const deck = byId.get(deckId);
      if (deck !== undefined) byId.set(deckId, { ...deck, visibility, firstSharedAt });
    },
    async setPublicToken(deckId, publicToken) {
      const deck = byId.get(deckId);
      if (deck !== undefined) byId.set(deckId, { ...deck, publicToken });
    },
    async addComment(input) {
      const id = CommentId.of(comments.length + 1);
      comments.push({ id, ...input, deletedAt: null, deletedBy: null });
      return id;
    },
    async lockComment(commentId) {
      const comment = comments.find((candidate) => candidate.id === commentId);
      const deck = comment === undefined ? undefined : byId.get(comment.deckId);
      if (comment === undefined || deck === undefined) return null;
      return { ...comment, deckOwnerId: deck.ownerId };
    },
    async markDeleted(commentId, deletedBy, at) {
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (comment !== undefined) Object.assign(comment, { body: "", deletedAt: at, deletedBy });
    },
  };
  return { ...repository, deck: (deckId: DeckId) => byId.get(deckId), comments };
}
