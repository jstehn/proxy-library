import { describe, expect, it } from "vitest";
import type { SealedContent } from "@/modules/catalog";
import { sampleContent as c } from "../testing/contents";
import { contentsValue, type ValueSources } from "./contents-value";

// A sealed product's average contents value (design doc 27, section 3.2).

const pack = (boosterType: string): SealedContent => c.pack("LEA", boosterType);
const BOX: readonly SealedContent[] = [pack("default"), pack("default"), pack("default")];

const sources: ValueSources = {
  pack: (_set, boosterType) => (boosterType === "default" ? 127_627.3 : null),
  card: (printingId, finish) => (printingId === "lotus" ? (finish === "foil" ? 900 : 500) : 0),
  deck: (_set, deckName) => (deckName === "Starter" ? 1_250 : null),
  product: (productId) => (productId === "box" ? BOX : null),
};

describe("contentsValue", () => {
  it("adds packs, cards and decks, rounding the total down to the cent", () => {
    expect(
      contentsValue(
        [
          pack("default"),
          c.card("lotus", "foil"),
          c.deck("LEA", "Starter"),
          { kind: "other", name: "Spindown" },
        ],
        sources,
      ),
    ).toEqual({ value: 127_627 + 900 + 1_250, isPartial: false });
  });

  it("multiplies nested products by their count", () => {
    const value = contentsValue([c.sealed("box", 2)], sources);
    expect(value).toEqual({ value: Math.floor(6 * 127_627.3), isPartial: false });
  });

  it("averages a variable content's options (opening picks one at random)", () => {
    const value = contentsValue(
      [
        {
          kind: "variable",
          options: [[c.card("lotus", "nonfoil")], [c.card("lotus", "foil")]],
        },
      ],
      sources,
    );
    expect(value).toEqual({ value: 700, isPartial: false });
  });

  it("counts what it can't value as $0 and says the value is partial", () => {
    expect(
      contentsValue(
        [pack("collector"), c.deck("LEA", "Missing"), c.card("lotus", "nonfoil")],
        sources,
      ),
    ).toEqual({ value: 500, isPartial: true });
    expect(contentsValue([c.sealed("gone", 1)], sources)).toEqual({ value: 0, isPartial: true });
  });

  it("doesn't lose a cent to float noise", () => {
    const third = { ...sources, pack: () => 100 / 3 };
    expect(contentsValue([pack("a"), pack("a"), pack("a")], third).value).toBe(100);
  });

  it("throws on a product that contains itself", () => {
    const loop: ValueSources = {
      ...sources,
      product: () => [c.sealed("loop", 1)],
    };
    expect(() => contentsValue([c.sealed("loop", 1)], loop)).toThrow(/loop/);
  });
});
