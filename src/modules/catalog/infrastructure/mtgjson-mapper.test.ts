import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentReferences, missingReferences, supportingSetCodes } from "../domain/rules";
import { PrintingId, type SetImport } from "../domain/types";
import { mapSetFile, mapSetSummary } from "./mtgjson-mapper";
import { MtgjsonSetFile, MtgjsonSetListFile } from "./mtgjson-schema";

// These tests use trimmed REAL MTGJSON data (tests/fixtures/README.md).
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/mtgjson/${name}`, "utf8"));

const blb: SetImport = mapSetFile(MtgjsonSetFile.parse(readFixture("BLB.json")));
const spg: SetImport = mapSetFile(MtgjsonSetFile.parse(readFixture("SPG.json")));
const byNumber = (number: string) => blb.printings.find((p) => p.collectorNumber === number);

describe("mapSetFile: set and printings", () => {
  it("reads the set's details", () => {
    expect(blb.set).toMatchObject({ code: "BLB", name: "Bloomburrow", type: "expansion" });
    expect(blb.version).toBe("5.3.0+20260926");
  });

  it("keeps printings that exist in paper, even when they are also on Arena or MTGO", () => {
    // Every real Bloomburrow card is available on paper + MTGO (+ Arena).
    expect(blb.printings).toHaveLength(27);
    expect(blb.printings.every((printing) => printing.setCode === "BLB")).toBe(true);
  });

  it("skips the (synthetic) Arena-only Alchemy printing", () => {
    expect(blb.printings.find((p) => p.name.startsWith("A-"))).toBeUndefined();
    expect(blb.skipped.printings).toBe(1);
  });

  it("describes treatments in words", () => {
    expect(byNumber("295")?.variantLabel).toBe("Borderless · Showcase");
    expect(byNumber("356")?.variantLabel).toBe("Extended Art");
    expect(byNumber("343")?.variantLabel).toBe("Borderless · Showcase · Raised Foil");
    expect(byNumber("386")?.variantLabel).toBe("Bundle Promo");
    expect(byNumber("1")?.variantLabel).toBe("");
  });

  it("keeps finishes, ids and card details", () => {
    const card = byNumber("1");
    expect(card?.name).toBe("Banishing Light");
    expect(card?.finishes).toEqual(["nonfoil", "foil"]);
    expect(card?.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
    expect(card?.oracleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(byNumber("386")?.finishes).toEqual(["foil"]); // the bundle promo is foil-only
  });
});

describe("mapSetFile: boosters", () => {
  it("keeps the paper play booster and skips the Arena-only one (rule 9)", () => {
    expect(blb.boosters.map((booster) => booster.boosterType)).toEqual(["play"]);
    expect(blb.skipped.boosterTypes).toEqual(["play-arena"]);
  });

  it("keeps variants, sheet flags and weights", () => {
    const play = blb.boosters[0];
    expect(play.variants[0]).toEqual({
      weight: 788,
      slots: { common: 7, foil: 1, land: 1, rareMythicWithShowcase: 1, uncommon: 3, wildcard: 1 },
    });
    expect(play.sheets.foil.isFoil).toBe(true);
    expect(play.sheets.common.isFoil).toBe(false);
    expect(play.sheets.common.cards).toHaveLength(10);
    expect(play.sourceSetCodes).toEqual(["BLB", "SPG"]);
  });
});

describe("mapSetFile: sealed products and decks", () => {
  it("keeps paper products (boxes, cases, bundle, starter kit) and skips MTGO redemption", () => {
    expect(blb.products.map((product) => product.name).sort()).toEqual([
      "Bloomburrow Bundle",
      "Bloomburrow Play Booster Box",
      "Bloomburrow Play Booster Box Case",
      "Bloomburrow Play Booster Pack",
      "Bloomburrow Starter Kit",
    ]);
    expect(blb.skipped.products).toEqual(["Bloomburrow MTGO Redemption"]);
  });

  it("maps the bundle's nested contents", () => {
    const bundle = blb.products.find((product) => product.name === "Bloomburrow Bundle");
    const refs = contentReferences(bundle?.contents ?? []);
    expect(refs.productIds).toHaveLength(1); // 9 play boosters, as one "sealed" entry
    expect(bundle?.contents).toContainEqual(expect.objectContaining({ kind: "sealed", count: 9 }));
    expect(bundle?.contents).toContainEqual(
      expect.objectContaining({ kind: "card", finish: "foil" }), // the foil promo
    );
    expect(refs.decks).toEqual([{ setCode: "BLB", deckName: "Bloomburrow Bundle Land Pack" }]);
  });

  it("leaves Arena/MTGO code inserts out of a product's extras", () => {
    const starterKit = blb.products.find((product) => product.name === "Bloomburrow Starter Kit");
    const extras = (starterKit?.contents ?? []).flatMap((c) =>
      c.kind === "other" ? [c.name] : [],
    );
    expect(extras.some((name) => /arena|mtgo/i.test(name))).toBe(false);
  });

  it("keeps the starter kit deck and bundle land pack, and skips the MTGO redemption deck", () => {
    expect(blb.decks.map((deck) => deck.name).sort()).toEqual([
      "Bloomburrow Bundle Land Pack",
      "Hare Raising",
    ]);
    expect(blb.skipped.decks).toEqual(["Bloomburrow Redemption"]);
    const hare = blb.decks.find((deck) => deck.name === "Hare Raising");
    expect(hare?.cards.every((card) => card.count > 0)).toBe(true);
  });
});

describe("references (rule 5)", () => {
  it("names Special Guests (SPG) as a supporting set", () => {
    expect(supportingSetCodes(blb)).toEqual(["SPG"]);
  });

  it("finds nothing missing once the supporting set's printings are known", () => {
    const spgIds = new Set(spg.printings.map((printing) => printing.id));
    const known = {
      hasPrinting: (id: PrintingId) => spgIds.has(id),
      hasProduct: () => false,
      hasBooster: () => false,
      hasDeck: () => false,
    };
    expect(missingReferences(blb, known)).toEqual([]);
  });

  it("reports the special-guest sheet when SPG hasn't been imported", () => {
    const nothingKnown = {
      hasPrinting: () => false,
      hasProduct: () => false,
      hasBooster: () => false,
      hasDeck: () => false,
    };
    expect(missingReferences(blb, nothingKnown)).toEqual([
      "booster play, sheet specialGuest: 2 unknown card(s)",
    ]);
  });

  it("would catch a digital-only card slipping into a paper booster", () => {
    const sneaky: SetImport = {
      ...blb,
      boosters: [
        {
          ...blb.boosters[0],
          sheets: {
            ...blb.boosters[0].sheets,
            common: {
              ...blb.boosters[0].sheets.common,
              cards: [
                { printingId: PrintingId.of("00000000-a1c4-4e3a-8000-000000000001"), weight: 1 },
              ],
            },
          },
        },
      ],
    };
    const known = {
      hasPrinting: () => false,
      hasProduct: () => false,
      hasBooster: () => false,
      hasDeck: () => false,
    };
    expect(missingReferences(sneaky, known)).toContain(
      "booster play, sheet common: 1 unknown card(s)",
    );
  });
});

describe("mapSetSummary", () => {
  it("reads SetList entries, including online-only ones (filtered later)", () => {
    const list = MtgjsonSetListFile.parse(readFixture("SetList.json"));
    const codes = list.data.map((entry) => mapSetSummary(entry).code);
    expect(codes.sort()).toEqual(["BLB", "BLC", "FDN", "SPG", "YBLB"]);
    expect(list.data.find((entry) => entry.code === "YBLB")?.isOnlineOnly).toBe(true);
  });
});
