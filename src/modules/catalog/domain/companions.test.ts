import { describe, expect, it } from "vitest";
import { companionsToEnable, withoutBrokenReferences, yieldsSomething } from "./rules";
import { PrintingId, SealedProductId, SetCode, type SetImport } from "./types";

// Found with real data (2026-09-27): MTGJSON listed the Reality Fracture precon with no contents
// (the deck lives in the FRC companion set), and the store sold it as an empty box.

describe("yieldsSomething (rule 5b)", () => {
  it("is true only when opening gives a pack, product, deck or card", () => {
    expect(yieldsSomething([])).toBe(false);
    expect(yieldsSomething([{ kind: "other", name: "Spindown" }])).toBe(false);
    expect(
      yieldsSomething([
        { kind: "deck", setCode: SetCode.of("FRC"), deckName: "Multiverse Reforged" },
      ]),
    ).toBe(true);
    expect(
      yieldsSomething([
        {
          kind: "variable",
          options: [
            [{ kind: "other", name: "Dice" }],
            [{ kind: "card", printingId: PrintingId.of("x"), finish: "foil" }],
          ],
        },
      ]),
    ).toBe(true);
  });
});

describe("withoutBrokenReferences leaves out products with nothing inside", () => {
  const set: SetImport = {
    set: {
      code: SetCode.of("FRA"),
      name: "Reality Fracture",
      releaseDate: "2026-09-01",
      type: "expansion",
      keyruneCode: "fra",
      parentCode: null,
    },
    version: "5.3.0",
    printings: [],
    boosters: [],
    decks: [],
    products: [
      {
        id: SealedProductId.of("empty"),
        setCode: SetCode.of("FRA"),
        name: "Precon (no contents yet)",
        category: "deck",
        subtype: "commander",
        releaseDate: null,
        contents: [],
      },
      {
        id: SealedProductId.of("extras"),
        setCode: SetCode.of("FRA"),
        name: "Just a spindown",
        category: "other",
        subtype: null,
        releaseDate: null,
        contents: [{ kind: "other", name: "Spindown" }],
      },
    ],
    productCardSetCodes: [],
    skipped: { printings: 0, boosterTypes: [], products: [], decks: [] },
  };
  const knowsNothing = {
    hasPrinting: () => false,
    hasProduct: () => false,
    hasBooster: () => false,
    hasDeck: () => false,
  };

  it("reports why, and keeps neither", () => {
    const checked = withoutBrokenReferences(set, knowsNothing);
    expect(checked.setImport.products).toEqual([]);
    expect(checked.leftOut).toEqual([
      'product "Precon (no contents yet)": MTGJSON lists no contents yet',
      'product "Just a spindown": contains nothing to open',
    ]);
  });
});

describe("withoutBrokenReferences leaves out decks with no cards", () => {
  it("and the products that contain them (found with real data: TMT's Enemy Deck)", () => {
    const set: SetImport = {
      set: {
        code: SetCode.of("TMT"),
        name: "Turtles",
        releaseDate: "2026-03-01",
        type: "expansion",
        keyruneCode: "tmt",
        parentCode: null,
      },
      version: "5.3.0",
      printings: [],
      boosters: [],
      decks: [
        {
          setCode: SetCode.of("TMT"),
          name: "Enemy Deck",
          type: "Theme Deck",
          cards: [],
          sourceSetCodes: [],
        },
      ],
      products: [
        {
          id: SealedProductId.of("team-up"),
          setCode: SetCode.of("TMT"),
          name: "Turtle Team-Up",
          category: "deck",
          subtype: null,
          releaseDate: null,
          contents: [{ kind: "deck", setCode: SetCode.of("TMT"), deckName: "Enemy Deck" }],
        },
      ],
      productCardSetCodes: [],
      skipped: { printings: 0, boosterTypes: [], products: [], decks: [] },
    };
    const knowsNothing = {
      hasPrinting: () => false,
      hasProduct: () => false,
      hasBooster: () => false,
      hasDeck: () => false,
    };
    const checked = withoutBrokenReferences(set, knowsNothing);
    expect(checked.setImport.decks).toEqual([]);
    expect(checked.setImport.products).toEqual([]);
    expect(checked.leftOut[0]).toBe('deck "Enemy Deck": MTGJSON lists no cards yet');
  });
});

describe("companionsToEnable (rule 11)", () => {
  const set = (code: string, type: string, parentCode: string | null, isEnabled: boolean) => ({
    code: SetCode.of(code),
    type,
    parentCode: parentCode === null ? null : SetCode.of(parentCode),
    isEnabled,
  });

  it("enables the Commander sets of enabled sets, and nothing else", () => {
    expect(
      companionsToEnable([
        set("SOS", "expansion", null, true),
        set("SOC", "commander", "SOS", false), // precons: yes
        set("PSOS", "promo", "SOS", false), // promos: no
        set("STX", "expansion", null, false),
        set("C21", "commander", "STX", false), // parent not enabled: no
        set("FRA", "expansion", null, true),
        set("FRC", "commander", "FRA", true), // already enabled: nothing to do
      ]),
    ).toEqual(["SOC"]);
  });
});
