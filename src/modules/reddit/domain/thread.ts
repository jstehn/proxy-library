import type { RedditPostId } from "./post-id";

export type RedditComment = Readonly<{
  id: string;
  author: string;
  score: number;
  depth: number;
  body: string;
  createdUtc: number;
}>;

export type RedditThread = Readonly<{
  postId: RedditPostId;
  url: string;
  subreddit: string;
  title: string;
  author: string;
  score: number;
  numComments: number;
  createdUtc: number;
  selftext: string;
  comments: readonly RedditComment[];
}>;

export type FormattedThreadPage = Readonly<{
  text: string;
  cursor: number;
  nextCursor?: number;
  returnedItems: number;
  totalItems: number;
}>;

const DEFAULT_MAX_BYTES = 10_000;
const textEncoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return textEncoder.encode(value).length;
}

export function cleanRedditText(raw: string): string {
  return raw
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatThreadItem(thread: RedditThread, index: number): string | null {
  if (index === 0) {
    const body = cleanRedditText(thread.selftext);
    const header = `[OP u/${thread.author} | +${thread.score}]`;
    return body.length > 0 ? `${header}\n${body}` : `${header}\n(link/image post, no body text)`;
  }

  const comment = thread.comments[index - 1];
  if (!comment) return null;
  const body = cleanRedditText(comment.body);
  if (body.length === 0) return null;

  const indent = comment.depth > 0 ? "  ".repeat(Math.min(comment.depth, 4)) : "";
  const prefix = `${indent}[u/${comment.author} | +${comment.score}${comment.depth > 0 ? ` | reply d${comment.depth}` : ""}]`;
  const indentedBody = indent
    ? body
        .split("\n")
        .map((line) => `${indent}${line}`)
        .join("\n")
    : body;
  return `${prefix}\n${indentedBody}`;
}

/**
 * Formats a slice of a Reddit thread (item 0 = OP post, items 1..N = comments) starting at `cursor`
 * and fitting strictly within `maxBytes` without splitting mid-comment.
 */
export function formatThreadPage(
  thread: RedditThread,
  options: {
    cursor?: number;
    maxBytes?: number;
  } = {},
): FormattedThreadPage {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalItems = 1 + thread.comments.length;
  const start =
    options.cursor !== undefined && Number.isInteger(options.cursor) && options.cursor >= 0
      ? Math.min(options.cursor, totalItems)
      : 0;

  if (start >= totalItems) {
    return {
      text: "",
      cursor: start,
      returnedItems: 0,
      totalItems,
    };
  }

  const separator = "\n\n---\n\n";
  const sepBytes = utf8Bytes(separator);
  const blocks: string[] = [];
  let usedBytes = 0;
  let index = start;

  while (index < totalItems) {
    const formatted = formatThreadItem(thread, index);
    if (formatted === null) {
      index += 1;
      continue;
    }

    const pieceBytes = utf8Bytes(formatted) + (blocks.length > 0 ? sepBytes : 0);
    if (blocks.length > 0 && usedBytes + pieceBytes > maxBytes) {
      break;
    }

    blocks.push(formatted);
    usedBytes += pieceBytes;
    index += 1;
  }

  return {
    text: blocks.join(separator),
    cursor: start,
    ...(index < totalItems ? { nextCursor: index } : {}),
    returnedItems: blocks.length,
    totalItems,
  };
}
