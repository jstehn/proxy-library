import { describe, expect, it } from "vitest";
import { aLine } from "@/modules/decks/core/testing/deck-view";
import { deckOrder } from "./groups";

const names = (lines: readonly { name: string }[]) => lines.map((line) => line.name);

describe("deckOrder", () => {
  const commander = aLine("Leader", { board: "commander", typeLine: "Legendary Creature — Elf" });
  const forest = aLine("Forest", { typeLine: "Basic Land — Forest", manaValue: 0 });
  const bear = aLine("Bear", { manaValue: 2 });
  const elf = aLine("Elf", { manaValue: 1 });
  const bolt = aLine("Bolt", { typeLine: "Instant", manaValue: 1, heading: "Removal" });
  const spare = aLine("Spare", { board: "side" });
  const maybeBear = aLine("Bear", { board: "maybe" });

  it("follows the list by type: commander, types in order by cost, then the side and maybe boards", () => {
    const lines = [forest, maybeBear, spare, bear, bolt, commander, elf];
    expect(names(deckOrder(lines, "type", []))).toEqual([
      "Leader",
      "Elf",
      "Bear",
      "Bolt",
      "Forest",
      "Spare",
    ]);
  });

  it("puts the deck's own headings first when grouped by heading", () => {
    const lines = [forest, bear, bolt, commander, elf];
    expect(names(deckOrder(lines, "custom", ["Removal"]))).toEqual([
      "Leader",
      "Bolt",
      "Elf",
      "Bear",
      "Forest",
    ]);
  });

  it("lists a card on two boards once, where it shows first", () => {
    expect(names(deckOrder([maybeBear, bear], "type", []))).toEqual(["Bear"]);
    expect(deckOrder([maybeBear, bear], "type", [])[0]?.board).toBe("main");
  });

  it("is empty for an empty deck", () => {
    expect(deckOrder([], "type", [])).toEqual([]);
  });
});
