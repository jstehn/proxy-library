import { describe, expect, it } from "vitest";
import { copiesToTake, takeCopies } from "./free-copies";

// Taking a card from another of your decks (task 42).

describe("copiesToTake", () => {
  it("takes what this deck is short of free copies", () => {
    expect(copiesToTake(4, 1, 3)).toBe(3);
    expect(copiesToTake(4, 1, 2)).toBe(2);
  });

  it("takes none when enough are free already, or when the deck has none to give", () => {
    expect(copiesToTake(1, 2, 3)).toBe(0);
    expect(copiesToTake(4, 0, 0)).toBe(0);
  });
});

describe("takeCopies", () => {
  it("takes from the sideboard first, then the main deck", () => {
    const counts = [
      { board: "main" as const, quantity: 3 },
      { board: "side" as const, quantity: 1 },
    ];
    expect(takeCopies(counts, 1)).toEqual([{ board: "side", quantity: 0 }]);
    expect(takeCopies(counts, 3)).toEqual([
      { board: "side", quantity: 0 },
      { board: "main", quantity: 1 },
    ]);
  });

  it("never takes a commander", () => {
    expect(takeCopies([{ board: "commander", quantity: 1 }], 1)).toEqual([]);
  });
});
