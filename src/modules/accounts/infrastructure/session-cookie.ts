import { getSessionCookie } from "better-auth/cookies";

/**
 * Does this request carry a session cookie at all? A quick check with no database lookup,
 * for proxy.ts to bounce obviously signed-out visitors. It does NOT prove the session is
 * valid; `getActor` does that on every page and action (design doc 02, rule 10).
 */
export function hasSessionCookie(requestHeaders: Headers): boolean {
  return getSessionCookie(requestHeaders) !== null;
}
