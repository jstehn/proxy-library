import { describe, expect, it } from "vitest";
import { copyDeckName, MAX_NAME_LENGTH } from "./deck";

describe("copyDeckName (design doc 48)", () => {
  it("appends ' (copy)' and trims long names to fit MAX_NAME_LENGTH", () => {
    expect(copyDeckName("Beza")).toBe("Beza (copy)");
    expect(copyDeckName("  Beza  ")).toBe("Beza (copy)");
    const longName = "A".repeat(MAX_NAME_LENGTH);
    const copied = copyDeckName(longName);
    expect(copied.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(copied.endsWith(" (copy)")).toBe(true);
  });
});
