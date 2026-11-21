import type { CommentView } from "@/modules/decks";
import { MAX_COMMENT_LENGTH } from "@/modules/decks";
import { LocalTime } from "@/ui/local-time";
import { deleteCommentAction, postCommentAction } from "../actions";
import { Button } from "@/ui/button";
import { Textarea } from "@/ui/field";
import { EmptyState } from "@/ui/empty-state";

// A deck's comments (design doc 21): oldest first, a box to add one, and a delete button for
// those the viewer may remove (their own, any on their deck, or any at all for an admin).
// `asBox` shows them in a box you open, for the owner's page, where they sit above the builder.

export function DeckComments(props: {
  deckId: number;
  comments: readonly CommentView[];
  viewerId: string;
  viewerIsAdmin: boolean;
  isOwner: boolean;
  isShared: boolean;
  asBox?: boolean;
}) {
  const canDelete = (comment: CommentView) =>
    props.viewerIsAdmin || props.isOwner || comment.authorId === props.viewerId;
  const shownCount = props.comments.filter((comment) => comment.body !== null).length;
  const title = `Comments (${shownCount})`;
  const contents = (
    <>
      {props.isOwner && !props.isShared && (
        <p className="text-muted text-sm">
          This deck is private: only you can read these. Share it to let the playgroup comment.
        </p>
      )}
      {props.comments.length === 0 ? (
        <EmptyState>No comments yet.</EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {props.comments.map((comment) => (
            <li
              key={comment.id}
              id={`comment-${comment.id}`}
              className="bg-surface flex scroll-mt-20 flex-col gap-1 rounded-md p-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <strong>{comment.authorName}</strong>
                <span className="text-muted text-xs">
                  <LocalTime iso={comment.at} withTime />
                </span>
                <span className="flex-1" />
                {comment.body !== null && canDelete(comment) && (
                  <form action={deleteCommentAction}>
                    <input type="hidden" name="deckId" value={props.deckId} />
                    <input type="hidden" name="commentId" value={comment.id} />
                    <button
                      type="submit"
                      className="text-danger-text text-xs underline"
                      aria-label={`Delete ${comment.authorName}'s comment`}
                    >
                      Delete
                    </button>
                  </form>
                )}
              </div>
              {comment.body === null ? (
                <p className="text-muted italic">Comment removed.</p>
              ) : (
                <p className="break-words whitespace-pre-wrap">{comment.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <form action={postCommentAction} className="flex flex-col gap-2">
        <input type="hidden" name="deckId" value={props.deckId} />
        <Textarea
          name="body"
          rows={3}
          required
          maxLength={MAX_COMMENT_LENGTH}
          aria-label="Your comment"
          placeholder={props.isOwner ? "A note about this deck" : "What do you think of this deck?"}
        />
        <Button type="submit" className="self-start">
          Post comment
        </Button>
      </form>
    </>
  );
  if (props.asBox) {
    // Open when there's something to read. A link to #comments (or to one comment) opens it
    // too: browsers open a closed <details> when the address points inside it.
    return (
      <details
        id="comments"
        open={props.comments.length > 0}
        className="border-border-subtle scroll-mt-20 rounded-md border p-3"
      >
        <summary className="cursor-pointer font-medium">{title}</summary>
        <section aria-label="Comments" className="mt-3 flex flex-col gap-3">
          {contents}
        </section>
      </details>
    );
  }
  return (
    <section
      id="comments"
      aria-label="Comments"
      className="border-border-subtle flex scroll-mt-20 flex-col gap-3 border-t pt-6"
    >
      <h2 className="font-medium">{title}</h2>
      {contents}
    </section>
  );
}
