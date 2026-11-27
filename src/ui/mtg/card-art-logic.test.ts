import { describe, expect, it } from "vitest";
import { detectSwipeDirection, resolveCardFace, toggleCardFace, wrapIndex } from "./card-art-logic";

describe("resolveCardFace and toggleCardFace", () => {
  it("always returns front for single-faced cards", () => {
    expect(resolveCardFace({ printingId: "a", face: "back" }, "a", false)).toBe("front");
    expect(toggleCardFace(null, "a", false)).toEqual({ printingId: "a", face: "front" });
  });

  it("resets to front when switching to a different printing", () => {
    expect(resolveCardFace({ printingId: "a", face: "back" }, "b", true)).toBe("front");
  });

  it("toggles front and back for the same double-faced printing", () => {
    const first = toggleCardFace(null, "dfc-1", true);
    expect(first).toEqual({ printingId: "dfc-1", face: "back" });
    expect(resolveCardFace(first, "dfc-1", true)).toBe("back");

    const second = toggleCardFace(first, "dfc-1", true);
    expect(second).toEqual({ printingId: "dfc-1", face: "front" });
  });
});

describe("wrapIndex", () => {
  it("wraps around both ends", () => {
    expect(wrapIndex(0, -1, 5)).toBe(4);
    expect(wrapIndex(4, 1, 5)).toBe(0);
    expect(wrapIndex(2, 1, 5)).toBe(3);
  });

  it("returns 0 for empty lists", () => {
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
});

describe("detectSwipeDirection", () => {
  it("detects left swipe as next and right swipe as previous", () => {
    expect(detectSwipeDirection(-60, 10)).toBe("next");
    expect(detectSwipeDirection(60, -10)).toBe("previous");
  });

  it("ignores short drags and vertical scrolls", () => {
    expect(detectSwipeDirection(30, 0)).toBeNull();
    expect(detectSwipeDirection(-43, 0)).toBeNull();
    expect(detectSwipeDirection(50, 45)).toBeNull();
    expect(detectSwipeDirection(-50, -60)).toBeNull();
  });
});
