import { describe, expect, it } from "vitest";
import { cycleLine, findCycles, moduleGraph, nodeOf, type ImportGraph } from "./check-cycles";

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

describe("module cycles", () => {
  it("maps files to modules, and decks/domain files to their area", () => {
    expect(nodeOf("/p/src/modules/wallet/application/refresh.ts")).toBe("wallet");
    expect(nodeOf("/p/src/modules/decks/domain/goldfish.ts")).toBe("decks/play");
    expect(nodeOf("/p/src/modules/decks/domain/opening-hand/hand.ts")).toBe("decks/play");
    expect(nodeOf("/p/src/modules/decks/domain/deck.ts")).toBe("decks/core");
    expect(nodeOf("/p/src/modules/decks/queries/decks.ts")).toBe("decks");
    expect(nodeOf("/p/src/server/core.ts")).toBeUndefined();
  });

  it("joins files into module edges and finds a loop through wiring", () => {
    const files: ImportGraph = new Map([
      ["/p/src/modules/accounts/wiring.ts", ["/p/src/modules/wallet/index.ts"]],
      ["/p/src/modules/wallet/index.ts", ["/p/src/modules/wallet/domain/a.ts"]],
      ["/p/src/modules/wallet/domain/a.ts", ["/p/src/modules/accounts/index.ts"]],
      ["/p/src/modules/accounts/index.ts", []],
    ]);
    const cycles = findCycles(moduleGraph(files));
    expect(cycles.map(cycleLine)).toEqual(["accounts -> wallet -> accounts"]);
  });
});
