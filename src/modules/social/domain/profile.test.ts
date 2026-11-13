import { describe, expect, it } from "vitest";
import type { PrintingId } from "@/modules/catalog";
import { UserId } from "@/shared/kernel";
import {
  canViewSection,
  checkBio,
  checkShowcaseCards,
  defaultProfile,
  MAX_BIO_LENGTH,
  MAX_SHOWCASE_CARDS,
  normalizeFavoriteColors,
  normalizeFavoriteFormats,
} from "./profile";

describe("social profile domain", () => {
  it("creates a default profile with expected privacy defaults", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    const profile = defaultProfile(UserId.of("u1"), now);
    expect(profile.bio).toBe("");
    expect(profile.favoriteColors).toEqual([]);
    expect(profile.favoriteFormats).toEqual([]);
    expect(profile.showcaseDeckId).toBeNull();
    expect(profile.showcasePrintingIds).toEqual([]);
    expect(profile.statsVisibility).toBe("everyone");
    expect(profile.wishlistVisibility).toBe("friends");
    expect(profile.updatedAt).toBe(now);
  });

  it("trims and validates bio length", () => {
    expect(checkBio("  Hello world  ")).toEqual({ ok: true, value: "Hello world" });
    expect(checkBio("a".repeat(MAX_BIO_LENGTH))).toEqual({
      ok: true,
      value: "a".repeat(MAX_BIO_LENGTH),
    });
    const tooLong = checkBio("a".repeat(MAX_BIO_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error.kind).toBe("BioTooLong");
    }
  });

  it("normalizes favorite colors into WUBRG order without duplicates", () => {
    expect(normalizeFavoriteColors(["G", "W", "G", "U"])).toEqual(["W", "U", "G"]);
  });

  it("normalizes favorite formats without duplicates", () => {
    expect(normalizeFavoriteFormats(["commander", "modern", "commander"])).toEqual([
      "commander",
      "modern",
    ]);
  });

  it("deduplicates showcase cards and enforces max count", () => {
    const p1 = "p1" as PrintingId;
    const p2 = "p2" as PrintingId;
    const p3 = "p3" as PrintingId;
    const p4 = "p4" as PrintingId;

    expect(checkShowcaseCards([p1, p2, p1, p3])).toEqual({
      ok: true,
      value: [p1, p2, p3],
    });

    const tooMany = checkShowcaseCards([p1, p2, p3, p4]);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.error).toEqual({
        kind: "TooManyShowcaseCards",
        max: MAX_SHOWCASE_CARDS,
        actual: 4,
      });
    }
  });

  it("enforces section visibility rules", () => {
    expect(canViewSection("only_me", "self")).toBe(true);
    expect(canViewSection("only_me", "friend")).toBe(false);
    expect(canViewSection("only_me", "none")).toBe(false);

    expect(canViewSection("friends", "self")).toBe(true);
    expect(canViewSection("friends", "friend")).toBe(true);
    expect(canViewSection("friends", "pending_outgoing")).toBe(false);
    expect(canViewSection("friends", "pending_incoming")).toBe(false);
    expect(canViewSection("friends", "none")).toBe(false);

    expect(canViewSection("everyone", "none")).toBe(true);
    expect(canViewSection("everyone", "pending_incoming")).toBe(true);
  });
});
