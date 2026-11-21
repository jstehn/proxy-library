import { describe, expect, it } from "vitest";
import { COLLECTION_EXPORTERS, csvField, type ExportRow } from "./export";

const rows: ExportRow[] = [
  {
    name: "Lightning Bolt",
    setCode: "M11",
    collectorNumber: "149",
    finish: "nonfoil",
    rarity: "common",
    quantity: 4,
    priceCents: 150,
    firstAcquired: "2026-09-01T10:00:00Z",
    lastAcquired: "2026-09-20T10:00:00Z",
  },
  {
    name: "Delver of Secrets // Insectile Aberration",
    setCode: "ISD",
    collectorNumber: "51",
    finish: "foil",
    rarity: "common",
    quantity: 1,
    priceCents: null,
    firstAcquired: "2026-09-02T10:00:00Z",
    lastAcquired: "2026-09-02T10:00:00Z",
  },
];

describe("csvField", () => {
  it("quotes only when needed, and doubles quotes", () => {
    expect(csvField("Lightning Bolt")).toBe("Lightning Bolt");
    expect(csvField("Borrowing 100,000 Arrows")).toBe('"Borrowing 100,000 Arrows"');
    expect(csvField('Kongming, "Sleeping Dragon"')).toBe('"Kongming, ""Sleeping Dragon"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(4)).toBe("4");
  });
});

describe("exporters", () => {
  it("writes Moxfield's CSV: lowercase set codes, foil column", () => {
    const lines = COLLECTION_EXPORTERS.moxfield(rows).split("\r\n");
    expect(lines[0]).toBe(
      "Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number,Alter,Proxy,Purchase Price",
    );
    expect(lines[1]).toBe("4,0,Lightning Bolt,m11,Near Mint,English,,,2026-09-20,149,False,False,");
    expect(lines[2]).toBe(
      "1,0,Delver of Secrets // Insectile Aberration,isd,Near Mint,English,foil,,2026-09-02,51,False,False,",
    );
  });

  it("writes a text list with foil markers", () => {
    expect(COLLECTION_EXPORTERS.text(rows)).toBe(
      "4 Lightning Bolt (M11) 149\n1 Delver of Secrets // Insectile Aberration (ISD) 51 *F*\n",
    );
  });

  it("writes a full CSV with values in dollars", () => {
    const lines = COLLECTION_EXPORTERS.full(rows).split("\r\n");
    expect(lines[1]).toBe(
      "M11,149,Lightning Bolt,nonfoil,common,4,1.50,6.00,2026-09-01,2026-09-20",
    );
    expect(lines[2]).toContain(",foil,common,1,,,");
  });
});
