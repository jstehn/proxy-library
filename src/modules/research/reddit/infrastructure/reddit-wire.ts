import { z } from "zod";
import { HttpError } from "@/shared/http";
import type { RedditError } from "../application";
import { parseRedditPostId, type RedditComment, type RedditSearchPost } from "../domain";

// What Reddit, Arctic Shift, Brave and SearXNG send back, and the pure helpers that read it
// (ADR 0007). The gateway next door does the calling.

export const PostDataSchema = z.object({
  id: z.string(),
  subreddit: z.string().default(""),
  title: z.string().default(""),
  author: z.string().default("[deleted]"),
  score: z.number().default(0),
  num_comments: z.number().default(0),
  created_utc: z.number().default(0),
  selftext: z.string().default(""),
  permalink: z.string().optional(),
});

export const ListingChildSchema = z.object({
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const ListingSchema = z.object({
  kind: z.literal("Listing"),
  data: z.object({
    children: z.array(ListingChildSchema),
  }),
});

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().default(3600),
});

export const ArcticDataSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).nullable(),
});

export const BraveSearchSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string().default(""),
          url: z.string(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

export const SearxngSearchSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().default(""),
      url: z.string(),
      content: z.string().optional(),
    }),
  ),
});

export function classifyRedditError(error: unknown, fallbackMessage: string): RedditError {
  if (error instanceof HttpError) {
    if (error.status === 404 || error.status === 410) {
      return { kind: "PostNotFound", message: "The Reddit post was not found or was removed." };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        kind: "UpstreamError",
        message:
          "Reddit blocked anonymous access (HTTP 403). Configure BRAVE_SEARCH_API_KEY or SEARXNG_URL for Reddit search.",
      };
    }
    if (error.status === 429) {
      return {
        kind: "RateLimited",
        message: "Reddit rate-limited the request. Wait a moment and try again.",
      };
    }
    return {
      kind: "UpstreamError",
      message: `${fallbackMessage}: HTTP ${error.status}`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/429|rate limit|too many requests/i.test(message)) {
    return {
      kind: "RateLimited",
      message: "Reddit rate-limited the request. Wait a moment and try again.",
    };
  }
  return { kind: "UpstreamError", message: `${fallbackMessage}: ${message}` };
}

export function snippetOf(text: string, maxLen = 220): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length <= maxLen ? cleaned : `${cleaned.slice(0, maxLen - 1)}…`;
}

export function flattenComments(
  children: ReadonlyArray<{ kind: string; data: Record<string, unknown> }>,
  depth: number,
  maxComments: number,
  out: RedditComment[],
): void {
  for (const child of children) {
    if (out.length >= maxComments) return;
    if (child.kind !== "t1") continue;

    const data = child.data;
    const body = typeof data.body === "string" ? data.body : "";
    const author = typeof data.author === "string" ? data.author : "[deleted]";
    const id = typeof data.id === "string" ? data.id : `c${out.length}`;
    const score = typeof data.score === "number" ? data.score : 0;
    const createdUtc = typeof data.created_utc === "number" ? data.created_utc : 0;

    if (body.trim().length > 0 && body !== "[deleted]" && body !== "[removed]") {
      out.push({ id, author, score, depth, body, createdUtc });
    }

    const repliesParsed = ListingSchema.safeParse(data.replies);
    if (repliesParsed.success && out.length < maxComments) {
      flattenComments(repliesParsed.data.data.children, depth + 1, maxComments, out);
    }
  }
}

export function buildSiteSearchQuery(query: string, subreddit: string): string {
  if (subreddit === "all") {
    return `site:reddit.com/r/ ${query}`;
  }
  const subs = subreddit.split("+").filter(Boolean);
  if (subs.length === 1) {
    return `site:reddit.com/r/${subs[0]} ${query}`;
  }
  const siteFilter = subs.map((s) => `site:reddit.com/r/${s}`).join(" OR ");
  return `(${siteFilter}) ${query}`;
}

export function buildBraveSiteQuery(query: string, subreddit: string): string {
  if (subreddit === "all") {
    return `site:reddit.com ${query}`;
  }
  const subs = subreddit.split("+").filter(Boolean);
  if (subs.length === 1) {
    return `site:reddit.com r/${subs[0]} ${query}`;
  }
  const subFilter = subs.map((s) => `r/${s}`).join(" OR ");
  return `site:reddit.com (${subFilter}) ${query}`;
}

export function extractSubredditFromUrl(url: string): string {
  const match = /\/r\/([A-Za-z0-9_]+)\//i.exec(url);
  return match?.[1] ?? "";
}

export function mapWebHitsToPosts(
  items: ReadonlyArray<{ title: string; url: string; snippet?: string }>,
  limit: number,
): RedditSearchPost[] {
  const seen = new Set<string>();
  const posts: RedditSearchPost[] = [];
  for (const item of items) {
    if (posts.length >= limit) break;
    const parsedId = parseRedditPostId(item.url);
    if (!parsedId.ok || seen.has(parsedId.value)) continue;
    seen.add(parsedId.value);
    const subreddit = extractSubredditFromUrl(item.url);
    posts.push({
      postId: parsedId.value,
      url: item.url,
      subreddit,
      title: item.title.replace(/\s*:\s*r\/\w+\s*$/i, "").trim(),
      author: "unknown",
      score: 0,
      numComments: 0,
      createdUtc: 0,
      selftextSnippet: item.snippet ? snippetOf(item.snippet) : null,
    });
  }
  return posts;
}
