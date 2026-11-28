import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { after } from "next/server";
import { pageLabelFor, REQUEST_PATH_HEADER } from "./next-path";
import {
  hasActiveMetrics,
  openMetricStore,
  registerFallbackMetricStore,
  type MetricStore,
} from "./observability";

// Times every page render (the biggest source of queries, and the one thing the action and tool
// wrappers never saw). React `cache()` holds the store for the whole request across layout,
// `<Suspense>` boundaries, and page — unlike `AsyncLocalStorage.enterWith()` inside an async
// helper, which does not survive back to the caller after `await`.
//
// `readPage()` starts the store before awaiting `getCurrentActor()` so auth queries count, but
// waits until after actor lookup to call `after()`. Calling `after()` earlier registers the
// request with Next.js's `AfterContext`, which flips the request phase to `'after'` if the
// client disconnects early and makes Better Auth's `cookies()` throw E1381.

const getPageMetricSlot = cache((): { store: MetricStore | undefined } => ({
  store: undefined,
}));

registerFallbackMetricStore(() => getPageMetricSlot().store);

export function startPageMetrics(): (() => Promise<void>) | undefined {
  if (hasActiveMetrics()) return undefined;
  // Outside a React Server Component render (route handlers, scripts, tests), `cache()` returns
  // a fresh object each time. Skip those so we don't register `after()` on SSE routes or tests.
  const slot = getPageMetricSlot();
  if (slot !== getPageMetricSlot()) return undefined;

  const opened = openMetricStore({ kind: "page", label: "page" });
  slot.store = opened.store;

  return async function schedulePageMetricsFinish(): Promise<void> {
    try {
      const requestHeaders = await headers();
      const pathname = requestHeaders.get(REQUEST_PATH_HEADER);
      if (pathname !== null) opened.setLabel(pageLabelFor(pathname));
    } catch {
      // Ignore if headers are unavailable (e.g. outside a request).
    }
    try {
      after(() => {
        opened.finish();
      });
    } catch {
      // Not inside a request: clear the slot so nothing stays attached.
      slot.store = undefined;
    }
  };
}
