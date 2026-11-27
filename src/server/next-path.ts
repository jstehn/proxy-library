// Where to go after signing in (design doc 30): back to the page that sent you here, but only
// a page on this site. "//evil.example" and "/\evil.example" are other sites to a browser.

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/** The sign-in page's address, remembering where to come back to. */
export function signInPathFor(next: string): string {
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** The request header `proxy.ts` sets to the page's path, so page metrics can label the page. */
export const REQUEST_PATH_HEADER = "x-pathname";

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,}|[\w-]{24,})$/i;

/** `/decks/3f2a…/edit` becomes `/decks/:id/edit`, so one page is one label, not one per deck. */
export function pageLabelFor(pathname: string): string {
  const segments = pathname
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment));
  return `page:${segments.join("/") || "/"}`;
}
