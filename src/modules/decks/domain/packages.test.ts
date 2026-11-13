import { describe, expect, it } from "vitest";
import { planPackageInsert, type PackageEntrySpec } from "./packages";

function entry(
  overrides: Partial<PackageEntrySpec> & { oracleId: string; name: string },
): PackageEntrySpec {
  return {
    quantity: 1,
    heading: "Self-Mill",
    note: null,
    colorIdentity: ["B", "G"],
    legalities: { commander: "legal", modern: "legal" },
    isBasicLand: false,
    ...overrides,
  };
}

describe("planPackageInsert", () => {
  it("adds legal on-color cards and skips off-color, illegal, or at-limit cards", () => {
    const entries: PackageEntrySpec[] = [
      entry({ oracleId: "satyr", name: "Satyr Wayfinder", colorIdentity: ["G"] }),
      entry({ oracleId: "bolt", name: "Lightning Bolt", colorIdentity: ["R"] }),
      entry({ oracleId: "lotus", name: "Black Lotus", legalities: { commander: "banned" } }),
      entry({ oracleId: "sol", name: "Sol Ring", colorIdentity: [] }),
    ];

    const plan = planPackageInsert(entries, [{ oracleId: "sol", quantity: 1 }], "commander", [
      "U",
      "B",
      "G",
    ]);

    expect(plan.toAdd).toEqual([
      {
        oracleId: "satyr",
        name: "Satyr Wayfinder",
        finalQuantity: 1,
        addedQuantity: 1,
        heading: "Self-Mill",
        note: null,
      },
    ]);
    expect(plan.skipped).toEqual([
      { oracleId: "bolt", name: "Lightning Bolt", reason: "off_color" },
      { oracleId: "lotus", name: "Black Lotus", reason: "illegal" },
      { oracleId: "sol", name: "Sol Ring", reason: "at_copy_limit" },
    ]);
  });

  it("caps 60-card additions at 4 copies", () => {
    const plan = planPackageInsert(
      [entry({ oracleId: "opt", name: "Opt", quantity: 4, colorIdentity: ["U"] })],
      [{ oracleId: "opt", quantity: 2 }],
      "modern",
      null,
    );
    expect(plan.toAdd[0]).toMatchObject({ finalQuantity: 4, addedQuantity: 2 });
  });
});
