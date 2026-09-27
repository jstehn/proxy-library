import { describe, expect, it } from "vitest";
import type { Finish } from "@/modules/catalog";
import { sampleFacts, samplePrintingId } from "../testing/recipes";
import type { PackCard } from "./pack";
import { revealOrder } from "./reveal";

function card(id: string, finish: Finish = "nonfoil"): PackCard {
  return { printingId: samplePrintingId(id), finish, sheet: "any" };
}

const names = (cards: readonly PackCard[]) =>
  cards.map((each) => `${each.printingId}${each.finish === "nonfoil" ? "" : ` (${each.finish})`}`);

describe("revealOrder (rule 8: build suspense)", () => {
  it("reveals commons, uncommons, basic lands, foils, then rares and mythics", () => {
    const shuffled = [
      card("m-1"),
      card("u-2", "foil"),
      card("l-forest"),
      card("u-1"),
      card("r-2"),
      card("c-W1"),
    ];
    expect(names(revealOrder(shuffled, sampleFacts))).toEqual([
      "c-W1",
      "u-1",
      "l-forest",
      "u-2 (foil)",
      "r-2",
      "m-1",
    ]);
  });

  it("saves the most valuable card for last within a group, whatever its rarity", () => {
    // A $3.00 foil rare, a $1.00 rare and a $15.00 mythic: cheapest first.
    const rares = [card("m-1"), card("r-1", "foil"), card("r-1")];
    expect(names(revealOrder(rares, sampleFacts))).toEqual(["r-1", "r-1 (foil)", "m-1"]);
  });

  it("breaks price ties by collector number, counting 9 before 10", () => {
    // c-W1 and c-U1 both cost 5¢; their sample collector numbers are 1 and 3.
    expect(names(revealOrder([card("c-U1"), card("c-W1")], sampleFacts))).toEqual(["c-W1", "c-U1"]);
  });

  it("doesn't change the list it's given", () => {
    const cards = [card("m-1"), card("c-W1")];
    revealOrder(cards, sampleFacts);
    expect(names(cards)).toEqual(["m-1", "c-W1"]);
  });
});
