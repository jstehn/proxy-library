import { describe, expect, it } from "vitest";
import { IS_GROUPS, SEARCH_BASICS, SEARCH_KEYWORDS, searchHelpText } from "./help";
import { IS_VALUES, parseSearch } from "./parse";

describe("the search reference", () => {
  it("has examples that all parse with no notes", () => {
    for (const row of [...SEARCH_BASICS, ...SEARCH_KEYWORDS]) {
      for (const example of row.example.split(/\s{2,}/)) {
        expect(parseSearch(example).notes, example).toEqual([]);
      }
    }
  });

  it("shows every is: value", () => {
    expect(IS_GROUPS.flatMap((group) => IS_VALUES[group])).toEqual(Object.values(IS_VALUES).flat());
  });

  it("prints as Markdown for the LLM tools, with every keyword and is: value", () => {
    const text = searchHelpText();
    expect(text).toContain("| `tag: role:` |");
    expect(text).toContain("`is:shockland`");
    expect(text).toContain('`o:"when ~ dies"`');
  });
});
