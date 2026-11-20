import { describe, expect, it } from "vitest";
import { countRegexes } from "./regex-count";

describe("countRegexes", () => {
  it("counts regex literals and new RegExp, and nothing else", () => {
    const source = [
      "const a = /draw a card/i.test(text);",
      "const b = text.replace(/\\(.*?\\)/g, '');",
      "const c = new RegExp('x' + name);",
      "const notRegex = 4 / 2 / 1; // a comment with /slashes/",
      "const s = 'a /string/ here';",
    ].join("\n");
    expect(countRegexes(source)).toBe(3);
  });
});
