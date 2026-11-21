import { describe, expect, it } from "vitest";
import { symbolCodeFor } from "./set-symbol";

describe("symbolCodeFor", () => {
  it("uses the set's own symbol when Keyrune has it", () => {
    expect(symbolCodeFor("SOS", null)).toBe("sos");
    expect(symbolCodeFor("SOC", "SOS")).toBe("soc");
  });

  it("falls back to the main set's symbol when Keyrune doesn't have the set's own yet", () => {
    expect(symbolCodeFor("FRC", "FRA")).toBe("fra"); // Reality Fracture Commander, Keyrune 3.19.0
  });

  it("gives null when neither has one, so the set's code is shown instead", () => {
    expect(symbolCodeFor("ZZZ", null)).toBeNull();
    expect(symbolCodeFor("ZZZ", "YYY")).toBeNull();
  });
});
