// Runs before every matching request (Next 16's name for middleware).
// Only a quick cookie-presence check: pages and actions do the real permission checks.
import { NextResponse, type NextRequest } from "next/server";
import { signInPathFor } from "@/server/next-path";
import { hasSessionCookie } from "@/server/session-cookie";

/** Pages anyone may open without signing in. The LLM tool endpoints sign in with a bearer
 * token instead of the cookie, and check it themselves (design doc 28). */
const PUBLIC_PATHS = [
  "/sign-in",
  "/register",
  "/d/",
  "/api/images/",
  "/api/health",
  "/api/mcp",
  "/api/tools",
  // OAuth for web connectors (design doc 30): discovery, registration and the token swap.
  "/.well-known/oauth-",
  "/api/oauth/",
];

export function proxy(request: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (isPublic || hasSessionCookie(request.headers)) return NextResponse.next();
  // Come back here after signing in (the OAuth approval page needs its query string).
  const next = request.nextUrl.pathname + request.nextUrl.search;
  return NextResponse.redirect(
    new URL(next === "/" ? "/sign-in" : signInPathFor(next), request.url),
  );
}

export const config = {
  // Skip Next's own files, static assets, and public PWA metadata/service-worker files.
  matcher: [
    "/((?!_next/static|_next/image|(?:favicon\\.ico|manifest\\.webmanifest|sw\\.js|icon\\.svg|apple-icon\\.png)$|icons/).*)",
  ],
};
