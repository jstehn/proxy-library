import { describe, expect, it } from "vitest";
import {
  compareToBaseline,
  countCodeLines,
  countProductionCodeLines,
  nextBaseline,
  parseAllowlist,
  type SourceFile,
} from "./sizes";

function file(path: string, codeLines: number, kind: "production" | "test" | "support") {
  const result: SourceFile = {
    path,
    lines: codeLines,
    codeLines,
    isTest: kind === "test",
    isTestSupport: kind === "support",
  };
  return result;
}

describe("countCodeLines", () => {
  it("skips blank lines, line comments and block comments", () => {
    const text = ["// header", "", "const a = 1;", "/* one", "two */", "const b = 2; // tail"].join(
      "\n",
    );
    expect(countCodeLines(text)).toBe(2);
  });
});

describe("countProductionCodeLines", () => {
  it("counts src, worker and scripts, but not tests, testing folders or fixtures", () => {
    const files = [
      file("src/modules/a/domain/a.ts", 10, "production"),
      file("worker/index.ts", 5, "production"),
      file("scripts/dev/sizes.ts", 3, "production"),
      file("src/modules/a/domain/a.test.ts", 100, "test"),
      file("src/modules/a/testing/fake.ts", 50, "support"),
      file("tests/fixtures/cards.ts", 70, "support"),
      file("tests/e2e/a.spec.ts", 40, "test"),
    ];
    expect(countProductionCodeLines(files)).toBe(18);
  });
});

describe("the baseline", () => {
  it("passes at the baseline, reports growth, and reports room to lower it", () => {
    expect(compareToBaseline(100, 100)).toEqual({ kind: "ok" });
    expect(compareToBaseline(105, 100)).toEqual({ kind: "over", difference: 5 });
    expect(compareToBaseline(90, 100)).toEqual({ kind: "lower", difference: 10 });
  });

  it("treats a missing baseline as room to write one", () => {
    expect(compareToBaseline(100, Infinity)).toEqual({ kind: "lower", difference: Infinity });
  });

  it("only ever lowers", () => {
    expect(nextBaseline(90, 100)).toBe(90);
    expect(nextBaseline(110, 100)).toBe(100);
  });
});

describe("parseAllowlist", () => {
  it("collects paths and reports entries without a reason", () => {
    const { allowed, missingReasons } = parseAllowlist("a.ts # big\n\n# note\nb.ts\n");
    expect([...allowed]).toEqual(["a.ts", "b.ts"]);
    expect(missingReasons).toEqual(["b.ts"]);
  });
});
