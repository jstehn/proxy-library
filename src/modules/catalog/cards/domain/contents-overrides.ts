import type { SealedContent, SealedProduct, SealedProductId, SetCode, SetImport } from "./types";

// Contents overrides (ADR 0031): what a sealed product holds, written down by us for products
// MTGJSON lists with no contents yet. Pure: the files are read and checked in infrastructure.

/**
 * One line of an override. Like MTGJSON's own contents, but a product inside another product is
 * named (its uuid isn't known when the file is written) and cards are not supported.
 */
export type OverrideContent =
  | Readonly<{ kind: "pack"; setCode: SetCode; boosterType: string }>
  | Readonly<{ kind: "product"; productName: string; count: number }>
  | Readonly<{ kind: "deck"; setCode: SetCode; deckName: string }>
  | Readonly<{ kind: "other"; name: string }>;

/** Everything one file says about one set: product name → what it contains. */
export type ContentsOverride = Readonly<{
  setCode: SetCode;
  /** Why the file exists and where the numbers came from, for the next person to read. */
  note: string;
  products: ReadonlyMap<string, readonly OverrideContent[]>;
}>;

export type AppliedOverrides = Readonly<{
  setImport: SetImport;
  /** Products that got their contents from the override, for the sync summary. */
  applied: readonly string[];
  /** Entries that could not be used, each with the reason. Never stops a sync. */
  problems: readonly string[];
}>;

/**
 * Gives contents to the set's products that MTGJSON lists with none. A product that already has
 * contents is never touched, so once MTGJSON catches up the override quietly stops mattering.
 */
export function applyContentsOverride(
  setImport: SetImport,
  override: ContentsOverride | undefined,
): AppliedOverrides {
  if (override === undefined) return { setImport, applied: [], problems: [] };

  const applied: string[] = [];
  const problems: string[] = [];
  const idsByName = new Map<string, SealedProductId>(
    setImport.products.map((product) => [product.name, product.id]),
  );

  for (const name of override.products.keys()) {
    if (!idsByName.has(name)) problems.push(`override for "${name}": MTGJSON has no such product`);
  }

  const products = setImport.products.map((product): SealedProduct => {
    const lines = override.products.get(product.name);
    if (lines === undefined || product.contents.length > 0) return product;
    const resolved = resolveLines(lines, idsByName);
    if (typeof resolved === "string") {
      problems.push(`override for "${product.name}": ${resolved}`);
      return product;
    }
    applied.push(product.name);
    return { ...product, contents: resolved };
  });

  return { setImport: { ...setImport, products }, applied, problems };
}

/** The lines as real contents, or the reason one of them can't be used. */
function resolveLines(
  lines: readonly OverrideContent[],
  idsByName: ReadonlyMap<string, SealedProductId>,
): SealedContent[] | string {
  const contents: SealedContent[] = [];
  for (const line of lines) {
    switch (line.kind) {
      case "pack":
        contents.push({ kind: "pack", setCode: line.setCode, boosterType: line.boosterType });
        break;
      case "product": {
        const productId = idsByName.get(line.productName);
        if (productId === undefined) return `contains "${line.productName}", which doesn't exist`;
        contents.push({ kind: "sealed", productId, count: line.count });
        break;
      }
      case "deck":
        contents.push({ kind: "deck", setCode: line.setCode, deckName: line.deckName });
        break;
      case "other":
        contents.push({ kind: "other", name: line.name });
        break;
    }
  }
  return contents;
}
