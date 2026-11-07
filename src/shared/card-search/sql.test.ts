import { describe, expect, it } from "vitest";
import { forPostgres } from "./sql";

describe("forPostgres", () => {
  it("reads \\b as a word boundary, as JavaScript does", () => {
    expect(forPostgres(String.raw`\bdies\b`)).toBe(String.raw`\ydies\y`);
  });

  it("leaves other escapes, and an escaped backslash before b, alone", () => {
    expect(forPostgres(String.raw`\{T\}\.\s\\b`)).toBe(String.raw`\{T\}\.\s\\b`);
  });
});
