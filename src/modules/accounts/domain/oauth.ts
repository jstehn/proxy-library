import type { UserId } from "@/shared/kernel";
import { SCOPES, TOKEN_NAME_MAX_LENGTH, tokenHash, withRead, type Scope } from "./access-token";

// OAuth for web connectors (design doc 30): the rules, as pure functions. The token a client
// ends up with is an ordinary access token (design doc 28).

/** How a client proves who it is at the token endpoint (RFC 7591, design doc 69, section 5). */
export const CLIENT_AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"] as const;
export type ClientAuthMethod = (typeof CLIENT_AUTH_METHODS)[number];

/** An app that registered itself (RFC 7591), such as claude.ai's connector, or an admin did. */
export type OAuthClient = Readonly<{
  clientId: string;
  /** What the client called itself. Anyone can choose any name (rule 5). */
  name: string;
  redirectUris: readonly string[];
  createdAt: Date;
  /** `none` is a public client (PKCE only); the others hold a secret. */
  authMethod: ClientAuthMethod;
  /** The SHA-256 of the client secret; null for a public client. The secret is never stored. */
  secretHash: string | null;
  /** The admin who made it by hand; null when the app registered itself. */
  createdBy: UserId | null;
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

/** Design doc 69: some vendors register one URI per region or product. Matched exactly. */
export const MAX_REDIRECT_URIS = 20;
const REDIRECT_URI_MAX_LENGTH = 500;
/** Rule 4: a code lives ten minutes. */
const CODE_LIFETIME_MILLISECONDS = 10 * 60_000;
const CLIENT_ID_PREFIX = "plc_";
const CLIENT_SECRET_PREFIX = "pls_";
/** RFC 7636: a verifier is 43 to 128 of these characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** base64url of a SHA-256: 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Bytes as base64url with no padding, as OAuth and PKCE use. */
function base64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new client id from 32 random bytes. */
export function clientIdFor(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new RangeError("a client id needs 32 random bytes");
  return CLIENT_ID_PREFIX + base64Url(randomBytes);
}

/** A new client secret from 32 random bytes; shown once, stored as a hash. */
export function clientSecretFor(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new RangeError("a client secret needs 32 random bytes");
  return CLIENT_SECRET_PREFIX + base64Url(randomBytes);
}

/** The method a registration asked for; none given means a public client. Null: not supported. */
export function authMethodFor(requested: string | undefined): ClientAuthMethod | null {
  if (requested === undefined) return "none";
  return CLIENT_AUTH_METHODS.find((method) => method === requested) ?? null;
}

export function isConfidential(client: Pick<OAuthClient, "authMethod">): boolean {
  return client.authMethod !== "none";
}

/** Text compared without stopping at the first difference (both are fixed-length hashes). */
function sameText(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Whether the client proved itself at the token endpoint: a public client sends no secret, a
 * confidential one sends the secret it was given.
 */
export async function clientAuthenticated(
  client: Pick<OAuthClient, "authMethod" | "secretHash">,
  presentedSecret: string | null,
): Promise<boolean> {
  if (!isConfidential(client)) return presentedSecret === null;
  if (presentedSecret === null || client.secretHash === null) return false;
  return sameText(await tokenHash(presentedSecret), client.secretHash);
}

/** The id and secret in an `Authorization: Basic` header (RFC 6749, section 2.3.1), or null. */
export function basicCredentials(header: string | null): { id: string; secret: string } | null {
  const match = /^Basic\s+(\S+)\s*$/i.exec(header ?? "");
  if (match === null) return null;
  try {
    const decoded = atob(match[1]);
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    // Both halves are form-encoded before they're joined.
    const unform = (text: string) => decodeURIComponent(text.replace(/\+/g, " "));
    return { id: unform(decoded.slice(0, colon)), secret: unform(decoded.slice(colon + 1)) };
  } catch {
    return null;
  }
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
