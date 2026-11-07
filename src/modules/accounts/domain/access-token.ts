import type { Brand, UserId } from "@/shared/kernel";

// Personal access tokens (design doc 28, section 3.1): how an LLM client signs in as a player.
// The secret is shown once; only its SHA-256 hash is stored (rule 2).

/** What a token may do. Every token can read (rule 3 checks the others per tool). */
export const SCOPES = ["read", "decks:write", "wishlist:write"] as const;
export type Scope = (typeof SCOPES)[number];

export type AccessTokenId = Brand<number, "AccessTokenId">;
export const AccessTokenId = {
  of(raw: number): AccessTokenId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a token id: ${raw}`);
    return raw as AccessTokenId;
  },
};

export type AccessToken = Readonly<{
  id: AccessTokenId;
  userId: UserId;
  /** What the player called it: "LM Studio on the desktop". */
  name: string;
  /** The first characters after "pl_", to tell tokens apart in the list. */
  prefix: string;
  scopes: readonly Scope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}>;

/** Rule 16: at most this many live tokens per player. */
export const MAX_LIVE_TOKENS = 10;
export const TOKEN_NAME_MAX_LENGTH = 60;
const PREFIX = "pl_";
const PREFIX_LENGTH = 8;
/** 32 random bytes, base64url: 43 characters. */
const SECRET_BODY = /^[A-Za-z0-9_-]{43}$/;

/** The secret for new random bytes: "pl_" and the bytes in base64url (no padding). */
export function tokenSecret(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new RangeError("a token needs 32 random bytes");
  const base64 = btoa(String.fromCharCode(...randomBytes));
  return PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether the text has a token's shape: checked before any database work. */
export function looksLikeToken(text: string): boolean {
  return text.startsWith(PREFIX) && SECRET_BODY.test(text.slice(PREFIX.length));
}

/** The part of a secret shown in the token list. */
export function tokenPrefix(secret: string): string {
  return secret.slice(PREFIX.length, PREFIX.length + PREFIX_LENGTH);
}

/** The stored form of a secret: its SHA-256, in hex. */
export async function tokenHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The secret in an `Authorization: Bearer …` header, or null. */
export function bearerSecret(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match === null ? null : match[1];
}

/** The scopes as stored: "read" always, each once, in SCOPES order. Unknown names are dropped. */
export function withRead(scopes: readonly string[]): Scope[] {
  const wanted = new Set<string>(["read", ...scopes]);
  return SCOPES.filter((scope) => wanted.has(scope));
}

export function allows(scopes: readonly Scope[], needed: Scope): boolean {
  return scopes.includes(needed);
}

/** Rule 16: "last used" is written at most once a minute per token. */
export function shouldTouch(lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt === null || now.getTime() - lastUsedAt.getTime() >= 60_000;
}

/** A token name, trimmed, or null when it's empty or too long. */
export function tokenName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length === 0 || name.length > TOKEN_NAME_MAX_LENGTH ? null : name;
}
