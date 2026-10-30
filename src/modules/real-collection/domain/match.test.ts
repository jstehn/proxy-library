import { describe, expect, it } from "vitest";
import { candidate } from "../testing/fakes";
import {
  isOrdinaryPrinting,
  matchLine,
  newestOrdinaryPrinting,
  normalizedName,
  type CatalogMatches,
} from "./match";
import type { ImportLine } from "./readers";

const regular = candidate({
  printingId: "regular",
  name: "Beza",
  releaseDate: "2024-08-02",
  collectorNumber: "2",
});
const newerPromo = candidate({
  printingId: "promo",
  name: "Beza",
  setCode: "PBLB",
  setType: "promo",
  collectorNumber: "2p",
  releaseDate: "2024-08-03",
  promoTypes: ["promopack", "stamped"],
});
const newerBorderless = candidate({
  printingId: "borderless",
  name: "Beza",
  setCode: "BLB",
  collectorNumber: "300",
  releaseDate: "2024-08-02",
  borderColor: "borderless",
});
const olderNonfoilOnly = candidate({
  printingId: "old",
  name: "Beza",
  setCode: "OLD",
  releaseDate: "2020-01-01",
  finishes: ["nonfoil"],
});
const all = [regular, newerPromo, newerBorderless, olderNonfoilOnly];

const matches: CatalogMatches = {
  byName: new Map([[normalizedName("Beza"), all]]),
  byScryfallId: new Map(all.map((each) => [each.scryfallId, each])),
};

function line(fields: Partial<ImportLine>): ImportLine {
  return {
    index: 0,
    quantity: 1,
    name: "Beza",
    setCode: null,
    collectorNumber: null,
    scryfallId: null,
    finish: "nonfoil",
    board: "main",
    ...fields,
  };
}

describe("the newest ordinary printing (section 4.1)", () => {
  it("skips promos and special treatments", () => {
    expect(isOrdinaryPrinting(regular)).toBe(true);
    expect(isOrdinaryPrinting(newerPromo)).toBe(false);
    expect(isOrdinaryPrinting(newerBorderless)).toBe(false);
    expect(isOrdinaryPrinting(candidate({ printingId: "x", frameEffects: ["showcase"] }))).toBe(
      false,
    );
    expect(
      isOrdinaryPrinting(candidate({ printingId: "x", promoTypes: ["universesbeyond"] })),
    ).toBe(true);
    expect(newestOrdinaryPrinting(all, "nonfoil")?.printingId).toBe("regular");
  });

  it("respects the finish", () => {
    const foilOnlyRegular = candidate({
      printingId: "r2",
      releaseDate: "2025-01-01",
      finishes: ["foil"],
    });
    expect(newestOrdinaryPrinting([foilOnlyRegular, olderNonfoilOnly], "nonfoil")?.printingId).toBe(
      "old",
    );
    expect(newestOrdinaryPrinting([olderNonfoilOnly], "etched")).toBeNull();
  });

  it("falls back to the newest printing when nothing is ordinary", () => {
    expect(newestOrdinaryPrinting([newerBorderless, newerPromo], "nonfoil")?.printingId).toBe(
      "promo",
    );
  });
});

describe("matchLine", () => {
  it("matches by Scryfall id exactly, even when the name is different", () => {
    const matched = matchLine(
      line({ name: "Beza (Japanese)", scryfallId: newerPromo.scryfallId }),
      matches,
    );
    expect(matched).toMatchObject({ kind: "Matched", printingId: "promo" });
  });

  it("matches by set and number, then by set alone, then by name", () => {
    expect(matchLine(line({ setCode: "BLB", collectorNumber: "300" }), matches)).toMatchObject({
      printingId: "borderless",
    });
    expect(matchLine(line({ setCode: "PBLB" }), matches)).toMatchObject({ printingId: "promo" });
    expect(matchLine(line({ name: "  BEZA " }), matches)).toMatchObject({ printingId: "regular" });
  });

  it("says why a line didn't match", () => {
    expect(matchLine(line({ name: "Nobody" }), matches)).toMatchObject({
      reason: { kind: "NoSuchCard" },
    });
    expect(matchLine(line({ setCode: "BLB", collectorNumber: "999" }), matches)).toMatchObject({
      reason: { kind: "NoSuchPrinting" },
    });
    expect(matchLine(line({ setCode: "OLD", finish: "foil" }), matches)).toMatchObject({
      reason: { kind: "FinishNotAvailable", finishes: ["nonfoil"] },
    });
  });
});
