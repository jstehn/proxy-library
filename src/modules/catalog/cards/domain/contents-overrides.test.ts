import { describe, expect, it } from "vitest";
import { applyContentsOverride, type ContentsOverride } from "./contents-overrides";
import { SealedProductId, SetCode, type SealedProduct, type SetImport } from "./types";

const setCode = SetCode.of("MBC");

function product(name: string, contents: SealedProduct["contents"] = []): SealedProduct {
  return {
    id: SealedProductId.of(`id-${name}`),
    setCode,
    name,
    category: "booster_pack",
    subtype: "draft_set",
    releaseDate: null,
    contents,
  };
}

function setImportOf(products: readonly SealedProduct[]): SetImport {
  // Only `products` matters to the function under test.
  return { products } as unknown as SetImport;
}

const override: ContentsOverride = {
  setCode,
  note: "test",
  products: new Map([
    ["Pack", [{ kind: "pack", setCode, boosterType: "draft" }]],
    ["Box", [{ kind: "product", productName: "Pack", count: 24 }]],
    ["Case", [{ kind: "product", productName: "Box", count: 6 }]],
  ]),
};

describe("applyContentsOverride (ADR 0031)", () => {
  it("gives contents to products that have none, resolving products by name", () => {
    const result = applyContentsOverride(
      setImportOf([product("Pack"), product("Box"), product("Case")]),
      override,
    );
    const [pack, box, caseProduct] = result.setImport.products;
    expect(pack?.contents).toEqual([{ kind: "pack", setCode, boosterType: "draft" }]);
    expect(box?.contents).toEqual([
      { kind: "sealed", productId: SealedProductId.of("id-Pack"), count: 24 },
    ]);
    expect(caseProduct?.contents).toEqual([
      { kind: "sealed", productId: SealedProductId.of("id-Box"), count: 6 },
    ]);
    expect(result.applied).toEqual(["Pack", "Box", "Case"]);
    expect(result.problems).toEqual([]);
  });

  it("never replaces contents MTGJSON already has", () => {
    const upstream = [{ kind: "other", name: "storage box" } as const];
    const result = applyContentsOverride(setImportOf([product("Pack", upstream)]), override);
    expect(result.setImport.products[0]?.contents).toEqual(upstream);
    expect(result.applied).toEqual([]);
  });

  it("leaves everything alone without an override", () => {
    const original = setImportOf([product("Pack")]);
    expect(applyContentsOverride(original, undefined)).toEqual({
      setImport: original,
      applied: [],
      problems: [],
    });
  });

  it("reports an override for a product MTGJSON doesn't have", () => {
    const result = applyContentsOverride(setImportOf([product("Pack")]), override);
    expect(result.problems).toContain('override for "Box": MTGJSON has no such product');
    expect(result.applied).toEqual(["Pack"]);
  });

  it("skips a product that contains a missing product, and says why", () => {
    const lonely: ContentsOverride = {
      ...override,
      products: new Map([["Box", [{ kind: "product", productName: "Gone", count: 2 }]]]),
    };
    const result = applyContentsOverride(setImportOf([product("Box")]), lonely);
    expect(result.setImport.products[0]?.contents).toEqual([]);
    expect(result.problems).toEqual(['override for "Box": contains "Gone", which doesn\'t exist']);
  });
});
