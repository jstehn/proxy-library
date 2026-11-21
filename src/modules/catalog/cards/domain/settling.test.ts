import { describe, expect, it } from "vitest";
import { isStillSettling } from "./rules";

describe("isStillSettling (rule 12)", () => {
  const now = new Date("2026-09-28T04:00:00Z");

  it("is true for sets released in the last 120 days, and for sets not out yet", () => {
    expect(isStillSettling("2026-09-01", now)).toBe(true); // Reality Fracture's age
    expect(isStillSettling("2026-06-01", now)).toBe(true); // 119 days
    expect(isStillSettling("2026-11-14", now)).toBe(true); // previewed, not released
  });

  it("is false for older sets, and for dates it can't read", () => {
    expect(isStillSettling("2026-05-30", now)).toBe(false); // 121 days
    expect(isStillSettling("2024-08-02", now)).toBe(false); // Bloomburrow
    expect(isStillSettling("", now)).toBe(false);
  });
});
