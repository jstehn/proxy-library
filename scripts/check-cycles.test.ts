import { describe, expect, it } from "vitest";
import { findCycles, type ImportGraph } from "./check-cycles";

const graph = (edges: Record<string, string[]>): ImportGraph => new Map(Object.entries(edges));

describe("findCycles", () => {
  it("finds nothing in a graph without loops, even where two files share an import", () => {
    expect(findCycles(graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] }))).toEqual([]);
  });

  it("reports a loop in import order", () => {
    expect(findCycles(graph({ a: ["b"], b: ["c"], c: ["a"] }))).toEqual([["a", "b", "c"]]);
  });

  it("reports a file that imports itself", () => {
    expect(findCycles(graph({ a: ["a"] }))).toEqual([["a"]]);
  });

  it("reports each loop once, and separate loops separately", () => {
    const cycles = findCycles(graph({ a: ["b"], b: ["a"], c: ["d"], d: ["c"], e: ["a", "c"] }));
    expect(cycles).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("ignores imports of files outside the graph", () => {
    expect(findCycles(graph({ a: ["react"] }))).toEqual([]);
  });
});
