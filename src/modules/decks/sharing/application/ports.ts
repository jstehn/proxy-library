import type { ActivityServices } from "@/modules/activity";
import type { DeckId } from "@/modules/decks/core/client";
import { type Clock, type UnitOfWork, type UserId } from "@/shared/kernel";
import type { Visibility } from "@/modules/decks/core/client";
import type { CommentId, DeckComment, DeckForSharing } from "../domain/sharing";

// Ports of the sharing area: what the sharing use cases need from outside.

/** Sharing decks and commenting on them (design doc 21, section 6). */
export interface DeckSharingRepository {
  /** The deck, locked until the transaction ends, or null if there's no such deck. */
  lockDeck(deckId: DeckId): Promise<DeckForSharing | null>;
  setVisibility(deckId: DeckId, visibility: Visibility, firstSharedAt: Date | null): Promise<void>;
  setPublicToken(deckId: DeckId, publicToken: string | null): Promise<void>;
  addComment(input: {
    deckId: DeckId;
    authorId: UserId;
    body: string;
    at: Date;
  }): Promise<CommentId>;
  /** The comment, locked, with its deck's owner, or null. */
  lockComment(commentId: CommentId): Promise<(DeckComment & { deckOwnerId: UserId }) | null>;
  markDeleted(commentId: CommentId, deletedBy: UserId, at: Date): Promise<void>;
}

export type DeckSharingServices = { deckSharing: DeckSharingRepository } & ActivityServices;

export type DeckSharingDependencies = {
  unitOfWork: UnitOfWork<DeckSharingServices>;
  clock: Clock;
  tokens: Readonly<{ newPublicToken(): string }>;
};
