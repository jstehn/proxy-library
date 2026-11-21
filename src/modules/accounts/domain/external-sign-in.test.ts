import { describe, expect, it } from "vitest";
import { hasRealEmail, parseEmail, placeholderEmail } from "./external-sign-in";

// The rules for linking an Authentik account (design doc 69, section 4.2).

describe("emails", () => {
  it("tidies a real email: trimmed, lower case", () => {
    expect(parseEmail("  Jack@Example.COM ")).toEqual({ ok: true, email: "jack@example.com" });
  });

  it("refuses what isn't an address, is too long, or is a placeholder", () => {
    expect(parseEmail("jack")).toMatchObject({ ok: false, reason: "isn't an email address" });
    expect(parseEmail("a b@example.com").ok).toBe(false);
    expect(parseEmail(`${"a".repeat(250)}@example.com`).ok).toBe(false);
    expect(parseEmail("jack@players.invalid").ok).toBe(false);
  });

  it("knows the placeholder from a real email", () => {
    expect(hasRealEmail(placeholderEmail("jack"))).toBe(false);
    expect(hasRealEmail("jack@example.com")).toBe(true);
  });
});
