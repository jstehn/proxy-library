import { z } from "zod";
import {
  fetchJson,
  platformFetch,
  withRateLimit,
  withRetry,
  withTimeout,
  withUserAgent,
  type Fetch,
  type Sleep,
} from "@/shared/http";
import { err, ok, type Clock, type Result } from "@/shared/kernel";
import type { RedditError, RedditGateway } from "../application";
import {
  parseRedditPostId,
  redditPostUrl,
  type RedditComment,
  type RedditPostId,
  type RedditSearchPost,
  type RedditThread,
} from "../domain";

import {
  ArcticDataSchema,
  BraveSearchSchema,
  ListingSchema,
  PostDataSchema,
  SearxngSearchSchema,
  TokenResponseSchema,
  buildBraveSiteQuery,
  buildSiteSearchQuery,
  classifyRedditError,
  flattenComments,
  mapWebHitsToPosts,
  snippetOf,
} from "./reddit-wire";

const THREAD_CACHE_MAX_ENTRIES = 50;
const THREAD_CACHE_TTL_MS = 20 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 50;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVICE_TIMEOUT_MS = 12_000;
const REDDIT_USER_AGENT = "linux:proxy-library:v0.1.0 (MTG deck-building research)";

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

function makeTimedLruCache<T>(clock: Clock, maxEntries: number, ttlMs: number) {
  const entries = new Map<string, { value: T; expiresAtMs: number }>();

  return {
    get(key: string): T | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (clock.now().getTime() >= entry.expiresAtMs) {
        entries.delete(key);
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.delete(key);
      if (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }
      entries.set(key, {
        value,
        expiresAtMs: clock.now().getTime() + ttlMs,
      });
    },
  };
}

function makeServiceFetch(perSecond: number, clock: Clock, sleep: Sleep, baseFetch: Fetch): Fetch {
  return withUserAgent(REDDIT_USER_AGENT)(
    withRateLimit({ perSecond, clock, sleep })(
      withRetry({ attempts: 2, sleep })(withTimeout(SERVICE_TIMEOUT_MS)(baseFetch)),
    ),
  );
}

/**
 * Anti-corruption layer over Reddit's API (ADR 0007). Uses OAuth2 (`oauth.reddit.com`) when
 * `clientId` + `clientSecret` are configured, Brave Search / SearXNG for `site:reddit.com`
 * search when configured, and falls back to public `.json` + Arctic Shift for thread lookups.
 */
export function redditHttpGateway(
  clock: Clock,
  options: {
    fetchFn?: Fetch;
    sleep?: Sleep;
    clientId?: string;
    clientSecret?: string;
    braveSearchApiKey?: string;
    searxngUrl?: string;
  } = {},
): RedditGateway {
  const sleep = options.sleep ?? defaultSleep;
  const baseFetch = options.fetchFn ?? platformFetch;
  const redditFetch = makeServiceFetch(1, clock, sleep, baseFetch);
  const arcticShiftFetch = makeServiceFetch(4, clock, sleep, baseFetch);
  const braveFetch = makeServiceFetch(2, clock, sleep, baseFetch);
  const searxngFetch = makeServiceFetch(4, clock, sleep, baseFetch);
  const threadCache = makeTimedLruCache<RedditThread>(
    clock,
    THREAD_CACHE_MAX_ENTRIES,
    THREAD_CACHE_TTL_MS,
  );
  const searchCache = makeTimedLruCache<readonly RedditSearchPost[]>(
    clock,
    SEARCH_CACHE_MAX_ENTRIES,
    SEARCH_CACHE_TTL_MS,
  );
  let tokenCache: TokenCache | null = null;

  const hasOAuth = Boolean(options.clientId && options.clientSecret);

  async function getAccessToken(): Promise<string | null> {
    if (!options.clientId || !options.clientSecret) return null;
    const now = clock.now().getTime();
    if (tokenCache && now < tokenCache.expiresAtMs - 30_000) {
      return tokenCache.token;
    }
    const creds = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");
    const raw = await fetchJson(redditFetch, "https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const parsed = TokenResponseSchema.parse(raw);
    tokenCache = {
      token: parsed.access_token,
      expiresAtMs: now + parsed.expires_in * 1000,
    };
    return tokenCache.token;
  }

  async function redditGet(pathAndQuery: string): Promise<unknown> {
    const token = await getAccessToken();
    if (token) {
      return fetchJson(redditFetch, `https://oauth.reddit.com${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const [path, query] = pathAndQuery.split("?");
    const jsonPath = path?.endsWith(".json") ? path : `${path}.json`;
    return fetchJson(redditFetch, `https://www.reddit.com${jsonPath}${query ? `?${query}` : ""}`);
  }

  async function fetchThreadFromArcticShift(
    postId: RedditPostId,
    commentLimit: number,
  ): Promise<RedditThread | null> {
    const [postRaw, commentsRaw] = await Promise.all([
      fetchJson(
        arcticShiftFetch,
        `https://arctic-shift.photon-reddit.com/api/posts/ids?ids=t3_${postId}`,
      ),
      fetchJson(
        arcticShiftFetch,
        `https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=t3_${postId}&limit=${commentLimit}`,
      ),
    ]);
    const postListing = ArcticDataSchema.safeParse(postRaw);
    const first = postListing.success ? postListing.data.data?.[0] : undefined;
    const postParsed = first ? PostDataSchema.safeParse(first) : null;
    if (!postParsed?.success) return null;

    const commentsListing = ArcticDataSchema.safeParse(commentsRaw);
    const comments: RedditComment[] = [];
    if (commentsListing.success && commentsListing.data.data) {
      const wrapped = commentsListing.data.data.map((item) => ({
        kind: typeof item.kind === "string" ? item.kind : "t1",
        data:
          typeof item.data === "object" && item.data !== null
            ? (item.data as Record<string, unknown>)
            : item,
      }));
      flattenComments(wrapped, 0, commentLimit, comments);
    }

    const data = postParsed.data;
    return {
      postId,
      url: data.permalink
        ? `https://www.reddit.com${data.permalink}`
        : redditPostUrl(postId, data.subreddit),
      subreddit: data.subreddit,
      title: data.title,
      author: data.author,
      score: data.score,
      numComments: data.num_comments,
      createdUtc: data.created_utc,
      selftext: data.selftext,
      comments,
    };
  }

  return {
    async searchPosts({ query, subreddit, sortBy, timeframe, limit }) {
      const searchCacheKey = JSON.stringify({
        query: query.trim().replace(/\s+/g, " ").toLowerCase(),
        subreddit: subreddit.trim().toLowerCase(),
        sortBy,
        timeframe,
        limit,
      });
      const cachedSearch = searchCache.get(searchCacheKey);
      if (cachedSearch) return ok(cachedSearch);

      const siteQuery = buildSiteSearchQuery(query, subreddit);

      if (!hasOAuth && options.braveSearchApiKey) {
        try {
          const braveParams = new URLSearchParams({
            q: buildBraveSiteQuery(query, subreddit),
            count: String(Math.min(20, Math.max(limit * 2, 10))),
          });
          if (timeframe !== "all") {
            const freshnessMap: Record<string, string> = {
              day: "pd",
              week: "pw",
              month: "pm",
              year: "py",
            };
            const f = freshnessMap[timeframe];
            if (f) braveParams.set("freshness", f);
          }
          const raw = await fetchJson(
            braveFetch,
            `https://api.search.brave.com/res/v1/web/search?${braveParams.toString()}`,
            {
              headers: {
                "X-Subscription-Token": options.braveSearchApiKey,
                Accept: "application/json",
              },
            },
          );
          const parsed = BraveSearchSchema.safeParse(raw);
          if (parsed.success) {
            const hits = (parsed.data.web?.results ?? []).map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.description,
            }));
            const mapped = mapWebHitsToPosts(hits, limit);
            if (mapped.length > 0 || !options.searxngUrl) {
              searchCache.set(searchCacheKey, mapped);
              return ok(mapped);
            }
          }
        } catch (error) {
          if (!options.searxngUrl) {
            return err(classifyRedditError(error, "Failed to search Reddit via Brave Search"));
          }
        }
      }

      if (!hasOAuth && options.searxngUrl) {
        try {
          const base = options.searxngUrl.replace(/\/+$/, "");
          const searxParams = new URLSearchParams({
            q: siteQuery,
            format: "json",
          });
          if (timeframe !== "all") {
            searxParams.set("time_range", timeframe);
          }
          const raw = await fetchJson(searxngFetch, `${base}/search?${searxParams.toString()}`);
          const parsed = SearxngSearchSchema.safeParse(raw);
          if (!parsed.success) {
            return err({
              kind: "UpstreamError",
              message: "Unexpected response shape from SearXNG.",
            });
          }
          const hits = parsed.data.results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
          }));
          const mapped = mapWebHitsToPosts(hits, limit);
          searchCache.set(searchCacheKey, mapped);
          return ok(mapped);
        } catch (error) {
          return err(classifyRedditError(error, "Failed to search Reddit via SearXNG"));
        }
      }

      const params = new URLSearchParams({
        q: query,
        sort: sortBy,
        t: timeframe,
        limit: String(limit),
        raw_json: "1",
      });
      if (subreddit !== "all") {
        params.set("restrict_sr", "1");
      }

      const path =
        subreddit === "all"
          ? `/search?${params.toString()}`
          : `/r/${subreddit}/search?${params.toString()}`;

      try {
        const raw = await redditGet(path);
        const parsed = ListingSchema.safeParse(raw);
        if (!parsed.success) {
          return err({
            kind: "UpstreamError",
            message: "Unexpected response shape from Reddit search.",
          });
        }

        const results: RedditSearchPost[] = [];
        for (const child of parsed.data.data.children) {
          if (child.kind !== "t3") continue;
          const post = PostDataSchema.safeParse(child.data);
          if (!post.success) continue;
          const parsedId = parseRedditPostId(post.data.id);
          if (!parsedId.ok) continue;

          results.push({
            postId: parsedId.value,
            url: post.data.permalink
              ? `https://www.reddit.com${post.data.permalink}`
              : redditPostUrl(parsedId.value, post.data.subreddit),
            subreddit: post.data.subreddit,
            title: post.data.title,
            author: post.data.author,
            score: post.data.score,
            numComments: post.data.num_comments,
            createdUtc: post.data.created_utc,
            selftextSnippet: snippetOf(post.data.selftext),
          });
        }

        searchCache.set(searchCacheKey, results);
        return ok(results);
      } catch (error) {
        return err(classifyRedditError(error, "Failed to search Reddit"));
      }
    },

    async fetchThread({
      postId,
      commentSort,
      commentLimit,
    }): Promise<Result<RedditThread, RedditError>> {
      const cacheKey = `${postId}:${commentSort}:${commentLimit}`;
      const cached = threadCache.get(cacheKey);
      if (cached) return ok(cached);

      if (!hasOAuth) {
        try {
          const archived = await fetchThreadFromArcticShift(postId, commentLimit);
          if (archived) {
            threadCache.set(cacheKey, archived);
            return ok(archived);
          }
        } catch {
          // Fall back to direct Reddit JSON if Arctic Shift is unavailable or hasn't indexed a brand-new post.
        }
      }

      const params = new URLSearchParams({
        sort: commentSort,
        limit: String(commentLimit),
        raw_json: "1",
      });

      try {
        const raw = await redditGet(`/comments/${postId}?${params.toString()}`);
        const tuple = z.tuple([ListingSchema, ListingSchema]).safeParse(raw);
        if (!tuple.success) {
          return err({
            kind: "UpstreamError",
            message: "Unexpected response shape from Reddit thread.",
          });
        }

        const [postListing, commentsListing] = tuple.data;
        const firstPost = postListing.data.children.find((c) => c.kind === "t3");
        const postParsed = firstPost ? PostDataSchema.safeParse(firstPost.data) : null;
        if (!postParsed?.success) {
          return err({ kind: "PostNotFound", message: "The Reddit post was not found." });
        }

        const comments: RedditComment[] = [];
        flattenComments(commentsListing.data.children, 0, commentLimit, comments);

        const data = postParsed.data;
        const thread: RedditThread = {
          postId: (parseRedditPostId(data.id).ok ? data.id.toLowerCase() : postId) as RedditPostId,
          url: data.permalink
            ? `https://www.reddit.com${data.permalink}`
            : redditPostUrl(postId, data.subreddit),
          subreddit: data.subreddit,
          title: data.title,
          author: data.author,
          score: data.score,
          numComments: data.num_comments,
          createdUtc: data.created_utc,
          selftext: data.selftext,
          comments,
        };

        threadCache.set(cacheKey, thread);
        return ok(thread);
      } catch (error) {
        return err(classifyRedditError(error, "Failed to fetch Reddit thread"));
      }
    },
  };
}
