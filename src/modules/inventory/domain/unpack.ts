import type { CardGain } from "@/modules/collection";
import type { SealedContent, SealedProduct, SealedProductId } from "@/modules/catalog";
import { assertNever, randomInt, type Rng } from "@/shared/kernel";
import { itemForProduct, type NewItem } from "./item";

// Unpacking a product one level (design doc 06, section 3): the Composite pattern. A product's
// contents are a tree, and one function handles every kind of node.

/** What unpacking one product produces. */
export type UnpackPlan = Readonly<{
  items: readonly NewItem[]; // packs, decks and nested products, to open later
  cards: readonly CardGain[]; // loose cards, straight into the collection
  extras: readonly string[]; // things we don't model: "Bloomburrow Spindown"
}>;

/** Nested products, by id: unpacking needs their names and contents. */
export type ProductLookup = (productId: SealedProductId) => SealedProduct | null;

/** Every product id a product's contents refer to, in any "variable" option too. */
export function nestedProductIds(contents: readonly SealedContent[]): SealedProductId[] {
  return contents.flatMap((content) => {
    switch (content.kind) {
      case "sealed":
        return [content.productId];
      case "variable":
        return content.options.flatMap(nestedProductIds);
      case "pack":
      case "card":
      case "deck":
      case "other":
        return [];
      default:
        return assertNever(content);
    }
  });
}

/**
 * Unpacks one level. Returns null if a nested product is missing from the catalog. A "variable"
 * node (e.g. "one of these five decks") picks one option at random with the Rng, so the
 * choice is replayable from the unpacking's seed.
 */
export function unpack(
  contents: readonly SealedContent[],
  products: ProductLookup,
  rng: Rng,
): UnpackPlan | null {
  const items: NewItem[] = [];
  const cards: CardGain[] = [];
  const extras: string[] = [];

  function visit(content: SealedContent): boolean {
    switch (content.kind) {
      case "pack":
        items.push({
          content: { kind: "pack", setCode: content.setCode, boosterType: content.boosterType },
          name: `${content.setCode} ${content.boosterType} booster`,
          productId: null,
        });
        return true;
      case "sealed": {
        const product = products(content.productId);
        if (product === null) return false;
        for (let copy = 0; copy < content.count; copy++) items.push(itemForProduct(product));
        return true;
      }
      case "deck":
        items.push({
          content: { kind: "deck", setCode: content.setCode, deckName: content.deckName },
          name: content.deckName,
          productId: null,
        });
        return true;
      case "card":
        cards.push({ printingId: content.printingId, finish: content.finish, quantity: 1 });
        return true;
      case "other":
        extras.push(content.name);
        return true;
      case "variable": {
        if (content.options.length === 0) return true;
        const chosen = content.options[randomInt(rng, content.options.length)];
        return chosen.every(visit);
      }
      default:
        return assertNever(content);
    }
  }

  return contents.every(visit) ? { items, cards, extras } : null;
}
