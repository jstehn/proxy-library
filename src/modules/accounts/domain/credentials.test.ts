import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DisplayName, Password, Username } from "./credentials";

describe("Username.parse", () => {
  it.each([
    ["jack", "jack"],
    ["  Jack_99 ", "jack_99"],
    ["a-b", "a-b"],
    ["x".repeat(20), "x".repeat(20)],
  ])("accepts %j as %j", (raw, expected) => {
    expect(Username.parse(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(["ab", "x".repeat(21), "jack smith", "jäck", "jack!", ""])("rejects %j", (raw) => {
    const result = Username.parse(raw);
    expect(result.ok).toBe(false);
  });

  it("only ever accepts lowercase names within the length limits", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (raw) => {
        const result = Username.parse(raw);
        if (result.ok) {
          expect(result.value).toBe(result.value.toLowerCase());
          expect(result.value.length).toBeGreaterThanOrEqual(3);
          expect(result.value.length).toBeLessThanOrEqual(20);
        }
      }),
    );
  });
});

describe("DisplayName.parse", () => {
  it("trims surrounding spaces", () => {
    expect(DisplayName.parse("  Jack  ")).toEqual({ ok: true, value: "Jack" });
  });

  it.each(["", "   ", "x".repeat(41)])("rejects %j", (raw) => {
    expect(DisplayName.parse(raw).ok).toBe(false);
  });
});

describe("Password.parse", () => {
  it("accepts 6 characters, kept exactly as typed (spaces included)", () => {
    expect(Password.parse(" abc12")).toEqual({ ok: true, value: " abc12" });
  });

  it("rejects fewer than 6 or more than 128 characters", () => {
    expect(Password.parse("abc12")).toEqual({
      ok: false,
      error: { kind: "PasswordInvalid", reason: "must be at least 6 characters" },
    });
    expect(Password.parse("x".repeat(129)).ok).toBe(false);
  });
});
