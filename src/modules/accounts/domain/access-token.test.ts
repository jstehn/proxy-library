import { describe, expect, it } from "vitest";
import {
  allows,
  bearerSecret,
  looksLikeToken,
  shouldTouch,
  tokenHash,
  tokenName,
  tokenPrefix,
  tokenSecret,
  withRead,
} from "./access-token";

const bytes = (fill: number) => new Uint8Array(32).fill(fill);

describe("access token secrets", () => {
  it("are pl_ and 43 base64url characters", () => {
    const secret = tokenSecret(bytes(255));
    expect(secret).toBe(`pl_${"_".repeat(42)}8`);
    expect(looksLikeToken(secret)).toBe(true);
    expect(tokenSecret(bytes(0))).toBe(`pl_${"A".repeat(43)}`);
  });

  it("refuse the wrong number of bytes", () => {
    expect(() => tokenSecret(new Uint8Array(16))).toThrow(RangeError);
  });

  it("are told apart from near misses before any database work", () => {
    const secret = tokenSecret(bytes(7));
    expect(looksLikeToken(secret.slice(0, -1))).toBe(false);
    expect(looksLikeToken(`${secret}x`)).toBe(false);
    expect(looksLikeToken(secret.replace("pl_", "pk_"))).toBe(false);
    expect(looksLikeToken(`pl_${"=".repeat(43)}`)).toBe(false);
  });

  it("show their first eight characters in the list", () => {
    expect(tokenPrefix(`pl_ABCDEFGHrest`)).toBe("ABCDEFGH");
  });

  it("are stored as a stable SHA-256 in hex", async () => {
    expect(await tokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("are read from a bearer header", () => {
    expect(bearerSecret("Bearer pl_x")).toBe("pl_x");
    expect(bearerSecret("bearer   pl_x ")).toBe("pl_x");
    expect(bearerSecret("Basic abc")).toBeNull();
    expect(bearerSecret(null)).toBeNull();
  });
});

describe("scopes", () => {
  it("always include read, each once, in a fixed order", () => {
    expect(withRead([])).toEqual(["read"]);
    expect(withRead(["wishlist:write", "decks:write", "read", "wishlist:write"])).toEqual([
      "read",
      "decks:write",
      "wishlist:write",
    ]);
    expect(withRead(["spend"])).toEqual(["read"]);
  });

  it("allow only what they list", () => {
    expect(allows(["read"], "read")).toBe(true);
    expect(allows(["read"], "decks:write")).toBe(false);
  });
});

describe("shouldTouch and tokenName", () => {
  it("writes last used at most once a minute", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(shouldTouch(null, now)).toBe(true);
    expect(shouldTouch(new Date("2026-11-07T11:59:30Z"), now)).toBe(false);
    expect(shouldTouch(new Date("2026-11-07T11:59:00Z"), now)).toBe(true);
  });

  it("trims names and refuses empty or long ones", () => {
    expect(tokenName("  LM   Studio ")).toBe("LM Studio");
    expect(tokenName("   ")).toBeNull();
    expect(tokenName("x".repeat(61))).toBeNull();
  });
});
