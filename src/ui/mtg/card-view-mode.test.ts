import { describe, expect, it } from "vitest";
import {
  CARD_VIEW_STORAGE_KEY,
  parseCardViewMode,
  readCardViewMode,
  visibleParts,
  writeCardViewMode,
} from "./card-view-mode";

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("parseCardViewMode", () => {
  it("accepts the three modes", () => {
    expect(parseCardViewMode("image")).toBe("image");
    expect(parseCardViewMode("text")).toBe("text");
    expect(parseCardViewMode("both")).toBe("both");
  });

  it("falls back to the image for anything else", () => {
    expect(parseCardViewMode(null)).toBe("image");
    expect(parseCardViewMode("")).toBe("image");
    expect(parseCardViewMode("overlay")).toBe("image");
  });
});

describe("readCardViewMode and writeCardViewMode", () => {
  it("round-trips through a storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    writeCardViewMode(storage, "both");
    expect(values.get(CARD_VIEW_STORAGE_KEY)).toBe("both");
    expect(readCardViewMode(storage)).toBe("both");
  });

  it("uses the image when nothing is stored or there is no storage", () => {
    expect(readCardViewMode({ getItem: () => null })).toBe("image");
    expect(readCardViewMode(null)).toBe("image");
  });

  it("survives a storage that throws", () => {
    expect(readCardViewMode(throwingStorage)).toBe("image");
    expect(() => writeCardViewMode(throwingStorage, "text")).not.toThrow();
  });
});

describe("visibleParts", () => {
  it("shows what the mode says", () => {
    expect(visibleParts("image", true)).toEqual({ image: true, text: false });
    expect(visibleParts("text", true)).toEqual({ image: false, text: true });
    expect(visibleParts("both", true)).toEqual({ image: true, text: true });
  });

  it("shows the text for a card with no image", () => {
    expect(visibleParts("image", false)).toEqual({ image: false, text: true });
    expect(visibleParts("both", false)).toEqual({ image: false, text: true });
  });
});
