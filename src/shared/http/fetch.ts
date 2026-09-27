// Small, composable helpers for talking to other services over HTTP (patterns.md #14).
// Each wrapper takes a fetch function and returns a new one with one extra behavior, so
// they stack: withUserAgent(ua)(withRateLimit(...)(withRetry(...)(fetch))).
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Clock } from "@/shared/kernel";

/** The shape of the standard `fetch` function, so our wrappers fit anywhere fetch does. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type FetchWrapper = (next: Fetch) => Fetch;
export type Sleep = (milliseconds: number) => Promise<void>;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

/** Adds the headers services use to identify callers (Scryfall requires them). */
export function withUserAgent(userAgent: string): FetchWrapper {
  return (next) => (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", userAgent);
    if (!headers.has("Accept")) headers.set("Accept", "application/json;q=0.9,*/*;q=0.8");
    return next(url, { ...init, headers });
  };
}

/**
 * Spaces requests out to at most `perSecond` per second. Each call reserves the next free slot
 * before waiting, so calls made at the same moment still line up one after another.
 */
export function withRateLimit(options: {
  perSecond: number;
  clock: Clock;
  sleep: Sleep;
}): FetchWrapper {
  // Whole milliseconds, rounded UP so we never go faster than the limit. (Adding a fraction like
  // 166.666… to a large timestamp loses float precision; a property test caught that.)
  const interval = Math.ceil(1000 / options.perSecond);
  let nextFreeSlot = 0;

  return (next) => async (url, init) => {
    const now = options.clock.now().getTime();
    const slot = Math.max(now, nextFreeSlot);
    nextFreeSlot = slot + interval;
    if (slot > now) await options.sleep(slot - now);
    return next(url, init);
  };
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Tries again after network errors and "try later" responses (429, 5xx), waiting longer each
 * time (0.5 s, 1 s, 2 s, …) or as long as the server's Retry-After header asks.
 */
export function withRetry(options: {
  attempts: number;
  sleep: Sleep;
  baseDelayMs?: number;
}): FetchWrapper {
  const baseDelay = options.baseDelayMs ?? 500;

  return (next) => async (url, init) => {
    for (let attempt = 1; ; attempt++) {
      const isLastAttempt = attempt >= options.attempts;
      try {
        const response = await next(url, init);
        if (!RETRYABLE_STATUSES.has(response.status) || isLastAttempt) return response;
        await options.sleep(retryAfterMs(response) ?? baseDelay * 2 ** (attempt - 1));
      } catch (error) {
        if (isLastAttempt) throw error;
        await options.sleep(baseDelay * 2 ** (attempt - 1));
      }
    }
  };
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/** GET a URL and return its JSON body (unchecked: the caller parses it with Zod). */
export async function fetchJson(fetchFn: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchFn(url, init);
  if (!response.ok) throw new HttpError(url, response.status);
  return response.json();
}

/** GET a URL's raw bytes. */
export async function fetchBytes(fetchFn: Fetch, url: string): Promise<Uint8Array> {
  const response = await fetchFn(url);
  if (!response.ok) throw new HttpError(url, response.status);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Stream a (possibly large) download straight to a file, never holding it all in memory.
 * Writes to `<path>.partial` first and renames at the end, so a crash never leaves a
 * half-written file under the real name.
 */
export async function downloadToFile(fetchFn: Fetch, url: string, path: string): Promise<void> {
  const response = await fetchFn(url);
  if (!response.ok || response.body === null) throw new HttpError(url, response.status);
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  try {
    const body = Readable.fromWeb(response.body as unknown as WebReadableStream);
    await pipeline(body, createWriteStream(partial));
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/** The platform's own fetch, for composition roots to wrap (they may not call fetch directly). */
export const platformFetch: Fetch = (url, init) => fetch(url, init);
