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
