import { err, ok, type Brand, type Result } from "@/shared/kernel";

export type RedditPostId = Brand<string, "RedditPostId">;

export type ParsePostIdError = Readonly<{
  kind: "InvalidPostInput";
  message: string;
}>;

const POST_ID_RE = /^[a-z0-9]{4,12}$/i;
const FULLNAME_RE = /^t3_([a-z0-9]{4,12})$/i;
const REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "m.reddit.com",
]);

function invalid(message: string): Result<RedditPostId, ParsePostIdError> {
  return err({ kind: "InvalidPostInput", message });
}

/**
 * Extracts a Reddit post ID from:
 * - Raw base36 ID: `1abc2de` or fullname `t3_1abc2de`
 * - Short URL: `https://redd.it/1abc2de`
 * - Comment URL: `https://www.reddit.com/r/EDH/comments/1abc2de/some_title/` or `reddit.com/comments/1abc2de`
 */
export function parseRedditPostId(input: string): Result<RedditPostId, ParsePostIdError> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return invalid("Provide a Reddit post URL or post ID.");
  }

  const fullnameMatch = FULLNAME_RE.exec(trimmed);
  if (fullnameMatch?.[1]) {
    return ok(fullnameMatch[1].toLowerCase() as RedditPostId);
  }

  if (POST_ID_RE.test(trimmed)) {
    return ok(trimmed.toLowerCase() as RedditPostId);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return invalid(`Could not parse "${trimmed}" as a Reddit post URL or ID.`);
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  let candidate: string | undefined;
  if (host === "redd.it") {
    candidate = segments[0];
  } else if (REDDIT_HOSTS.has(host)) {
    const commentsIndex = segments.indexOf("comments");
    if (commentsIndex !== -1) {
      candidate = segments[commentsIndex + 1];
    }
  }

  if (candidate && POST_ID_RE.test(candidate)) {
    return ok(candidate.toLowerCase() as RedditPostId);
  }

  return invalid(`Could not extract a valid Reddit post ID from "${trimmed}".`);
}

export function redditPostUrl(postId: RedditPostId, subreddit?: string): string {
  return subreddit
    ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/`
    : `https://www.reddit.com/comments/${postId}/`;
}
