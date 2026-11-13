import type { CommentView } from "@/modules/decks";
import { MAX_COMMENT_LENGTH } from "@/modules/decks";
import { LocalTime } from "@/ui/local-time";
import { deleteCommentAction, postCommentAction } from "../actions";

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
        <p className="text-muted text-sm">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {props.comments.map((comment) => (
            <li
              key={comment.id}
              id={`comment-${comment.id}`}
              className="flex scroll-mt-20 flex-col gap-1 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900"
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
                      className="text-xs text-red-700 underline dark:text-red-400"
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
        <textarea
          name="body"
          rows={3}
          required
          maxLength={MAX_COMMENT_LENGTH}
          aria-label="Your comment"
          placeholder={props.isOwner ? "A note about this deck" : "What do you think of this deck?"}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Post comment
        </button>
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
        className="scroll-mt-20 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
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
      className="flex scroll-mt-20 flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800"
    >
      <h2 className="font-medium">{title}</h2>
      {contents}
    </section>
  );
}
