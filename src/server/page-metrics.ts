import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { pageLabelFor, REQUEST_PATH_HEADER } from "./next-path";
import { setMetricLabel, startMetrics } from "./observability";

// Times every page render (the biggest source of queries, and the one thing the action and tool
// wrappers never saw). `readPage()` calls `startPageMetrics()` first thing, so the queries and
// outbound calls the page makes afterwards are counted, and `after()` closes the entry once the
// response has been sent. A layout and its page both call `readPage()`; the first one wins.

export function startPageMetrics(): void {
  const finish = startMetrics({ kind: "page", label: "page" });
  if (finish === null) return;
  try {
    after(finish);
  } catch {
    // Not inside a request (a script or a test): nothing will close the entry, so skip it.
    return;
  }
  // `headers()` is async, so the label arrives a moment later, still inside this request.
  headers()
    .then((requestHeaders) => {
      const pathname = requestHeaders.get(REQUEST_PATH_HEADER);
      if (pathname !== null) setMetricLabel(pageLabelFor(pathname));
    })
    .catch(() => undefined);
}
