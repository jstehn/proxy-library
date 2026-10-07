import { describe, expect, it } from "vitest";
import { completeLines, progressFraction, progressLabel } from "./proxy-progress";

describe("progressFraction", () => {
  it("fills the bar stage by stage, never going backwards", () => {
    const steps = [
      { stage: "images", done: 0, total: 4 },
      { stage: "images", done: 2, total: 4 },
      { stage: "images", done: 4, total: 4 },
      { stage: "pages", done: 1, total: 2 },
      { stage: "pages", done: 2, total: 2 },
      { stage: "saving", done: 1, total: 1 },
    ] as const;
    const fractions = steps.map(progressFraction);
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((one, other) => one - other));
  });

  it("counts a stage with nothing to do as finished", () => {
    expect(progressFraction({ stage: "images", done: 0, total: 0 })).toBeCloseTo(0.65);
  });
});

describe("progressLabel", () => {
  it("says what's happening", () => {
    expect(progressLabel({ stage: "images", done: 12, total: 75 })).toBe("Card images: 12 of 75");
    expect(progressLabel({ stage: "pages", done: 3, total: 9 })).toBe("Drawing pages: 3 of 9");
    expect(progressLabel({ stage: "saving", done: 0, total: 1 })).toBe("Saving the PDF");
  });
});

describe("completeLines", () => {
  it("keeps a line cut in half until the rest arrives", () => {
    const first = completeLines("", '{"a":1}\n{"b"');
    expect(first).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
    const second = completeLines(first.rest, ":2}\n");
    expect(second).toEqual({ lines: ['{"b":2}'], rest: "" });
  });
});
