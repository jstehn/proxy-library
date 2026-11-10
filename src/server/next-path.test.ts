import { describe, expect, it } from "vitest";
import { safeNextPath, signInPathFor } from "./next-path";

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNextPath("/oauth/authorize?client_id=a&state=b")).toBe(
      "/oauth/authorize?client_id=a&state=b",
    );
  });

  it("refuses other sites and anything that isn't a path", () => {
    for (const raw of ["//evil.example", "/\\evil.example", "https://evil.example", "", null, 3]) {
      expect(safeNextPath(raw)).toBeNull();
    }
  });
});

describe("signInPathFor", () => {
  it("encodes the path", () => {
    expect(signInPathFor("/oauth/authorize?a=1&b=2")).toBe(
      "/sign-in?next=%2Foauth%2Fauthorize%3Fa%3D1%26b%3D2",
    );
  });
});
