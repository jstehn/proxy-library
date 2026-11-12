import type { Actor } from "@/modules/accounts";
import { recordEvent } from "@/modules/activity";
import { err, ok, type Result } from "@/shared/kernel";
import type { DeckId } from "../domain/deck";
import type { CommentInvalid, CommentNotFound, DeckNotFound, NotAllowed } from "../domain/errors";
import {
  canDeleteComment,
  canViewDeck,
  checkCommentBody,
  type CommentId,
  type Visibility,
} from "../domain/sharing";
import type { DeckSharingDependencies } from "./ports";

// Sharing decks with the playgroup, and comments on them (design doc 21, section 5). A deck
// someone may not see is "not found", never "forbidden" (invariant 1).

export type SetVisibilityError = DeckNotFound;
export type PostCommentError = DeckNotFound | CommentInvalid;
export type DeleteCommentError = CommentNotFound | NotAllowed;

export function makeDeckSharing(dependencies: DeckSharingDependencies) {
  const { unitOfWork, clock, tokens } = dependencies;

  /** Shares a deck with every player, or makes it private again. Owner only. */
  async function setVisibility(
    actor: Actor,
    input: { deckId: DeckId; visibility: Visibility },
  ): Promise<Result<void, SetVisibilityError>> {
    return unitOfWork.run<void, SetVisibilityError>(async (services) => {
      const deck = await services.deckSharing.lockDeck(input.deckId);
      if (deck === null || deck.ownerId !== actor.userId) return err({ kind: "DeckNotFound" });
      if (deck.visibility === input.visibility) return ok();
      const now = clock.now();
      // Announced once, the first time it's shared (invariant 2).
      const firstShare = input.visibility === "shared" && deck.firstSharedAt === null;
      await services.deckSharing.setVisibility(
        deck.id,
        input.visibility,
        firstShare ? now : deck.firstSharedAt,
      );
      if (firstShare) {
        await recordEvent(
          services,
          {
            kind: "deckShared",
            actorId: actor.userId,
            deckId: deck.id,
            deckName: deck.name,
            format: deck.format,
          },
          now,
        );
      }
      return ok();
    });
  }

  /** Comments on a deck the actor can see (invariant 3). */
  async function postComment(
    actor: Actor,
    input: { deckId: DeckId; body: string },
  ): Promise<Result<CommentId, PostCommentError>> {
    const body = checkCommentBody(input.body);
    if (!body.ok) return body;
    return unitOfWork.run<CommentId, PostCommentError>(async (services) => {
      const deck = await services.deckSharing.lockDeck(input.deckId);
      if (deck === null || !canViewDeck(actor.userId, deck)) return err({ kind: "DeckNotFound" });
      const now = clock.now();
      const id = await services.deckSharing.addComment({
        deckId: deck.id,
        authorId: actor.userId,
        body: body.value,
        at: now,
      });
      // The owner hears about it; nobody needs telling about their own note (invariant 5).
      if (deck.ownerId !== actor.userId) {
        await recordEvent(
          services,
          {
            kind: "deckComment",
            actorId: actor.userId,
            otherId: deck.ownerId,
            deckId: deck.id,
            deckName: deck.name,
          },
          now,
        );
      }
      return ok(id);
    });
  }

  /** Removes a comment's text, for its author, the deck's owner or an admin (invariant 4). */
  async function deleteComment(
    actor: Actor,
    commentId: CommentId,
  ): Promise<Result<void, DeleteCommentError>> {
    return unitOfWork.run<void, DeleteCommentError>(async (services) => {
      const comment = await services.deckSharing.lockComment(commentId);
      if (comment === null) return err({ kind: "CommentNotFound" });
      if (!canDeleteComment(actor, comment, { ownerId: comment.deckOwnerId })) {
        return err({ kind: "NotAllowed" });
      }
      if (comment.deletedAt !== null) return ok(); // already gone: nothing to do
      await services.deckSharing.markDeleted(comment.id, actor.userId, clock.now());
      return ok();
    });
  }

  async function updatePublicToken(
    actor: Actor,
    deckId: DeckId,
    nextToken: (existing: string | null) => string | null,
  ): Promise<Result<string | null, SetVisibilityError>> {
    return unitOfWork.run<string | null, SetVisibilityError>(async (services) => {
      const deck = await services.deckSharing.lockDeck(deckId);
      if (deck === null || deck.ownerId !== actor.userId) return err({ kind: "DeckNotFound" });
      const token = nextToken(deck.publicToken);
      if (token !== deck.publicToken) {
        await services.deckSharing.setPublicToken(deck.id, token);
      }
      return ok(token);
    });
  }

  /** Enables a public read-only link for the deck, returning its existing or new token. Owner only. */
  async function enablePublicLink(
    actor: Actor,
    input: { deckId: DeckId },
  ): Promise<Result<string, SetVisibilityError>> {
    const result = await updatePublicToken(
      actor,
      input.deckId,
      (existing) => existing ?? tokens.newPublicToken(),
    );
    return result.ok ? ok(result.value as string) : result;
  }

  /** Replaces the deck's public link with a fresh token, invalidating the old URL. Owner only. */
  async function rotatePublicLink(
    actor: Actor,
    input: { deckId: DeckId },
  ): Promise<Result<string, SetVisibilityError>> {
    const result = await updatePublicToken(actor, input.deckId, () => tokens.newPublicToken());
    return result.ok ? ok(result.value as string) : result;
  }

  /** Turns off the deck's public link so `/d/[token]` returns 404. Owner only. */
  async function revokePublicLink(
    actor: Actor,
    input: { deckId: DeckId },
  ): Promise<Result<void, SetVisibilityError>> {
    const result = await updatePublicToken(actor, input.deckId, () => null);
    return result.ok ? ok() : result;
  }

  return {
    setVisibility,
    postComment,
    deleteComment,
    enablePublicLink,
    rotatePublicLink,
    revokePublicLink,
  };
}

export type DeckSharing = ReturnType<typeof makeDeckSharing>;
