import type { UserId } from "@/shared/kernel";
import { SCOPES, TOKEN_NAME_MAX_LENGTH, withRead, type Scope } from "./access-token";

// OAuth for web connectors (design doc 30): the rules, as pure functions. The token a client
// ends up with is an ordinary access token (design doc 28).

/** An app that registered itself (RFC 7591), such as claude.ai's connector. */
export type OAuthClient = Readonly<{
  clientId: string;
  /** What the client called itself. Anyone can choose any name (rule 5). */
  name: string;
  redirectUris: readonly string[];
  createdAt: Date;
}>;

/** A one-time code from the approval page, as stored (only its hash is the key). */
export type AuthorizationCode = Readonly<{
  clientId: string;
  userId: UserId;
  redirectUri: string;
  /** The PKCE challenge: base64url(SHA-256(verifier)). */
  codeChallenge: string;
  scopes: readonly Scope[];
  expiresAt: Date;
}>;

export const MAX_REDIRECT_URIS = 5;
export const REDIRECT_URI_MAX_LENGTH = 500;
/** Rule 4: a code lives ten minutes. */
export const CODE_LIFETIME_MILLISECONDS = 10 * 60_000;
const CLIENT_ID_PREFIX = "plc_";
/** RFC 7636: a verifier is 43 to 128 of these characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** base64url of a SHA-256: 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Bytes as base64url with no padding, as OAuth and PKCE use. */
export function base64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new client id from 32 random bytes. */
export function clientIdFor(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new RangeError("a client id needs 32 random bytes");
  return CLIENT_ID_PREFIX + base64Url(randomBytes);
}

/** A new authorization code from 32 random bytes. */
export function codeSecret(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new RangeError("a code needs 32 random bytes");
  return base64Url(randomBytes);
}

/** Why a redirect URI can't be registered (rule 1), or null when it's fine. */
export function redirectUriProblem(raw: string): string | null {
  if (raw.length > REDIRECT_URI_MAX_LENGTH) {
    return `is longer than ${REDIRECT_URI_MAX_LENGTH} characters`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "isn't a URL";
  }
  if (url.hash !== "" || raw.includes("#")) return "has a fragment (#…)";
  if (url.protocol === "https:") return null;
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && isLocal) return null;
  return "must use https (or http on localhost)";
}

/** The client's own name, tidied; a stand-in when it gave none. */
export function clientName(raw: string | undefined): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  return name === "" ? "An app" : name.slice(0, TOKEN_NAME_MAX_LENGTH);
}

/** The access token's name: what the player sees in their token list. */
export function tokenNameFor(name: string): string {
  const suffix = " (connected app)";
  return name.slice(0, TOKEN_NAME_MAX_LENGTH - suffix.length) + suffix;
}

/**
 * The scopes a request asked for (a space-separated list), always with `read`. No `scope` at
 * all asks for every scope; unknown words are ignored.
 */
export function requestedScopes(scopeParameter: string | null): Scope[] {
  if (scopeParameter === null || scopeParameter.trim() === "") return [...SCOPES];
  return withRead(scopeParameter.trim().split(/\s+/));
}

export function isChallenge(text: string): boolean {
  return CHALLENGE.test(text);
}

/** Rule 3: whether the verifier is the one the challenge was made from (S256). */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER.test(verifier)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest)) === challenge;
}

export function codeExpiry(now: Date): Date {
  return new Date(now.getTime() + CODE_LIFETIME_MILLISECONDS);
}

/** The redirect URI with these query parameters added (keeping any it already has). */
export function withQuery(redirectUri: string, parameters: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== null) url.searchParams.set(name, value);
  }
  return url.toString();
}
