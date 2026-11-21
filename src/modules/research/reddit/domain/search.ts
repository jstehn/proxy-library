import { err, ok, type Result } from "@/shared/kernel";
import type { RedditPostId } from "./post-id";

export const REDDIT_SORT_MODES = ["relevance", "top", "new", "comments"] as const;
export type RedditSortMode = (typeof REDDIT_SORT_MODES)[number];

export const REDDIT_TIMEFRAMES = ["all", "year", "month", "week", "day"] as const;
export type RedditTimeframe = (typeof REDDIT_TIMEFRAMES)[number];

export const DEFAULT_MTG_SUBREDDITS = ["EDH", "CompetitiveEDH", "BudgetBrews", "magicTCG"] as const;

export type SearchQueryError = Readonly<{
  kind: "InvalidSearchQuery";
  message: string;
}>;

export type RedditSearchPost = Readonly<{
  postId: RedditPostId;
  url: string;
  subreddit: string;
  title: string;
  author: string;
  score: number;
  numComments: number;
  createdUtc: number;
  selftextSnippet: string | null;
}>;

const MTG_TERMS_RE = /\b(mtg|magic|commander|edh|cedh|deck|primer|budget)\b/i;
const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,30}(\+[A-Za-z0-9_]{2,30})*$/;

export function normalizeSubreddit(subreddit?: string): Result<string, SearchQueryError> {
  if (subreddit === undefined || subreddit.trim().length === 0) {
    return ok(DEFAULT_MTG_SUBREDDITS.join("+"));
  }
  const cleaned = subreddit
    .trim()
    .replace(/^\/?r\//i, "")
    .replace(/\/+$/, "");
  if (cleaned.toLowerCase() === "all") {
    return ok("all");
  }
  if (!SUBREDDIT_RE.test(cleaned)) {
    return err({
      kind: "InvalidSearchQuery",
      message: `Invalid subreddit "${subreddit}". Use a subreddit name like "EDH" or "all".`,
    });
  }
  return ok(cleaned);
}

/**
 * Shapes a search query for Reddit. When searching all of Reddit (`subreddit === "all"`),
 * appends `MTG` if no MTG/Commander term is already present. When searching MTG subreddits,
 * preserves the exact query so Reddit's strict AND search doesn't over-filter.
 */
export function buildRedditSearchQuery(
  query: string,
  subreddit: string,
): Result<string, SearchQueryError> {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return err({ kind: "InvalidSearchQuery", message: "Search query cannot be empty." });
  }
  if (subreddit === "all" && !MTG_TERMS_RE.test(trimmed)) {
    return ok(`${trimmed} MTG`);
  }
  return ok(trimmed);
}
