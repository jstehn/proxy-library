import { describe, expect, it } from "vitest";
import {
  clientName,
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
