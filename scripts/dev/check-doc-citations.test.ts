import { describe, expect, it } from "vitest";
import { findCitations, problemsWith } from "./check-doc-citations";

describe("findCitations", () => {
  it("finds 'design doc 09' and 'design doc 9x' phrases", () => {
    const found = findCitations("// see design doc 09 and Design Doc 28");
    expect(found.map((citation) => citation.number)).toEqual(["09", "28"]);
  });

  it("finds a bare 'doc NN' only in a file that mentions design", () => {
    expect(findCitations("see doc 28 §3")).toEqual([]);
    expect(findCitations("the design is in doc 28 §3").map((c) => c.number)).toEqual(["28"]);
  });

  it("finds links, with the archive path, and does not count them twice", () => {
    const found = findCitations("[x](docs/design/archive/28-llm-tools.md) and design/09-decks.md");
    expect(found.map((citation) => [citation.number, citation.path])).toEqual([
      ["28", "design/archive/28-llm-tools.md"],
      ["09", "design/09-decks.md"],
    ]);
  });
});

describe("problemsWith", () => {
  const numbers = new Set(["09", "28"]);
  const exists = (path: string): boolean => path === "docs/design/09-decks.md";

  it("accepts a number that has a doc, and the allowlisted missing ones", () => {
    expect(problemsWith({ line: 1, text: "", number: "28" }, numbers, exists)).toEqual([]);
    expect(problemsWith({ line: 1, text: "", number: "50" }, numbers, exists)).toEqual([]);
  });

  it("rejects an unknown number and a path that does not exist", () => {
    expect(problemsWith({ line: 1, text: "", number: "77" }, numbers, exists)).toHaveLength(1);
    const link = { line: 1, text: "", number: "28", path: "design/28-llm-tools.md" };
    expect(problemsWith(link, numbers, exists)).toHaveLength(1);
  });
});
