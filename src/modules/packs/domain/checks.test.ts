import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { SAMPLE_BOOSTER, sampleFacts, samplePrintingId } from "../testing/recipes";
import { packProblems } from "./checks";
import { generatePack, type GeneratedPack } from "./generate";
import type { PackCard } from "./pack";

// packProblems is what `check-packs` runs on every real recipe, so each problem it can report
// is shown here by breaking a good pack on purpose.

const good = generatePack(SAMPLE_BOOSTER, seededRng("good"), sampleFacts);

function broken(change: (cards: PackCard[]) => PackCard[]): GeneratedPack {
  return { ...good, cards: change([...good.cards]) };
}

const problems = (pack: GeneratedPack) => packProblems(SAMPLE_BOOSTER, pack, sampleFacts);

describe("packProblems", () => {
  it("finds nothing wrong with a generated pack", () => {
    expect(problems(good)).toEqual([]);
  });

  it("reports a missing card", () => {
    expect(
      problems(broken((cards) => cards.filter((card) => card.sheet !== "rareMythic"))),
    ).toEqual(['sheet "rareMythic": 0 cards, expected 1']);
  });

  it("reports a repeated card on a sheet that doesn't allow it", () => {
    const pack = broken((cards) => {
      const commons = cards.filter((card) => card.sheet === "common");
      return cards.map((card) => (card === commons[1] ? commons[0] : card));
    });
    expect(problems(pack)).toEqual(['sheet "common" repeated a card']);
  });

  it("reports an unknown printing and a finish the printing doesn't have", () => {
    const pack = broken((cards) =>
      cards.map((card, index) => {
        if (index === 0) return { ...card, printingId: samplePrintingId("nope") };
        if (index === 1) return { ...card, finish: "etched" as const };
        return card;
      }),
    );
    expect(problems(pack)).toEqual([
      expect.stringMatching(/^unknown printing nope/),
      expect.stringMatching(/doesn't come in etched$/),
    ]);
  });

  it("reports a card from a sheet the layout doesn't use, and a layout that doesn't exist", () => {
    const extra = broken((cards) => [...cards, { ...cards[0], sheet: "bonus" }]);
    expect(problems(extra)).toContain('card from unused sheet "bonus"');
    expect(problems({ ...good, variantIndex: 7 })).toEqual(["variant 7 doesn't exist"]);
  });
});
