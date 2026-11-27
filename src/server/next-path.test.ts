import { describe, expect, it } from "vitest";
import { pageLabelFor, safeNextPath, signInPathFor } from "./next-path";

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

describe("pageLabelFor", () => {
  it("keeps plain paths as they are", () => {
    expect(pageLabelFor("/")).toBe("page:/");
    expect(pageLabelFor("/admin/performance")).toBe("page:/admin/performance");
  });

  it("collapses ids so one page is one label", () => {
    expect(pageLabelFor("/decks/42/edit")).toBe("page:/decks/:id/edit");
    expect(pageLabelFor("/decks/3f2a9c1e-5b7d-4e8a-9c1d-0a1b2c3d4e5f")).toBe("page:/decks/:id");
    expect(pageLabelFor("/d/aB3dE5gH7jK9mN1pQ3sT5vX7")).toBe("page:/d/:id");
  });
});
