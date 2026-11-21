import { describe, expect, it } from "vitest";
import {
  authMethodFor,
  basicCredentials,
  clientAuthenticated,
  clientName,
  clientSecretFor,
  codeExpiry,
  pkceMatches,
  redirectUriProblem,
  requestedScopes,
  tokenNameFor,
  withQuery,
} from "./oauth";

// OAuth's pure rules (design doc 30).

describe("redirect URIs (rule 1)", () => {
  it("allows https anywhere, and http only on this computer", () => {
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("http://localhost:6274/oauth/callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:33418/callback")).toBeNull();
    expect(redirectUriProblem("http://example.com/callback")).toMatch(/https/);
    expect(redirectUriProblem("javascript:alert(1)")).toMatch(/https/);
  });

  it("refuses fragments, non-URLs and very long URIs", () => {
    expect(redirectUriProblem("https://claude.ai/callback#here")).toMatch(/fragment/);
    expect(redirectUriProblem("not a url")).toMatch(/URL/);
    expect(redirectUriProblem(`https://claude.ai/${"a".repeat(500)}`)).toMatch(/longer/);
  });
});

describe("PKCE (rule 3)", () => {
  it("matches RFC 7636's example", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceMatches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(await pkceMatches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cX")).toBe(false);
  });

  it("refuses a verifier that is too short", async () => {
    expect(await pkceMatches("short", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });
});

describe("scopes", () => {
  it("always includes read, and no scope asks for everything", () => {
    expect(requestedScopes("decks:write")).toEqual(["read", "decks:write"]);
    expect(requestedScopes("read made:up")).toEqual(["read"]);
    expect(requestedScopes(null)).toEqual(["read", "decks:write", "wishlist:write"]);
  });
});

describe("names, expiry and redirects", () => {
  it("tidies the client's name and names its token", () => {
    expect(clientName("  Claude   ")).toBe("Claude");
    expect(clientName(undefined)).toBe("An app");
    expect(tokenNameFor("Claude")).toBe("Claude (connected app)");
    expect(tokenNameFor("x".repeat(60)).length).toBe(60);
  });

  it("gives a code ten minutes", () => {
    expect(codeExpiry(new Date("2026-11-10T12:00:00Z")).toISOString()).toBe(
      "2026-11-10T12:10:00.000Z",
    );
  });

  it("adds the code and state, keeping the redirect URI's own query", () => {
    expect(withQuery("https://app.example/cb?keep=1", { code: "abc", state: null })).toBe(
      "https://app.example/cb?keep=1&code=abc",
    );
  });
});

describe("client secrets (design doc 69)", () => {
  it("makes a pls_ secret from 32 bytes, and no other length", () => {
    expect(clientSecretFor(new Uint8Array(32))).toMatch(/^pls_[A-Za-z0-9_-]{43}$/);
    expect(() => clientSecretFor(new Uint8Array(16))).toThrow(RangeError);
  });

  it("reads the requested auth method: none given is public, unknown is refused", () => {
    expect(authMethodFor(undefined)).toBe("none");
    expect(authMethodFor("none")).toBe("none");
    expect(authMethodFor("client_secret_basic")).toBe("client_secret_basic");
    expect(authMethodFor("client_secret_post")).toBe("client_secret_post");
    expect(authMethodFor("private_key_jwt")).toBeNull();
  });

  it("authenticates a confidential client by the secret's hash, a public one by no secret", async () => {
    const secret = clientSecretFor(new Uint8Array(32).fill(7));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const secretHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const confidential = { authMethod: "client_secret_basic", secretHash } as const;
    expect(await clientAuthenticated(confidential, secret)).toBe(true);
    expect(await clientAuthenticated(confidential, secret + "x")).toBe(false);
    expect(await clientAuthenticated(confidential, null)).toBe(false);
    const open = { authMethod: "none", secretHash: null } as const;
    expect(await clientAuthenticated(open, null)).toBe(true);
    expect(await clientAuthenticated(open, secret)).toBe(false);
  });

  it("reads Basic credentials, form-decoded, and rejects anything malformed", () => {
    const header = (text: string) => `Basic ${btoa(text)}`;
    expect(basicCredentials(header("plc_abc:pls_def"))).toEqual({
      id: "plc_abc",
      secret: "pls_def",
    });
    expect(basicCredentials(header("id:a%2Bb+c"))).toEqual({ id: "id", secret: "a+b c" });
    expect(basicCredentials(header("no-colon"))).toBeNull();
    expect(basicCredentials("Basic !!!")).toBeNull();
    expect(basicCredentials("Bearer abc")).toBeNull();
    expect(basicCredentials(null)).toBeNull();
  });
});
