// Runs before every matching request (Next 16's name for middleware).
// Only a quick cookie-presence check: pages and actions do the real permission checks.
import { NextResponse, type NextRequest } from "next/server";
import { hasSessionCookie } from "@/server/session-cookie";

/** Pages anyone may open without signing in. The LLM tool endpoints sign in with a bearer
 * token instead of the cookie, and check it themselves (design doc 28). */
const PUBLIC_PATHS = ["/sign-in", "/register", "/api/health", "/api/mcp", "/api/tools"];

export function proxy(request: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (isPublic || hasSessionCookie(request.headers)) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  // Skip Next's own files and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
