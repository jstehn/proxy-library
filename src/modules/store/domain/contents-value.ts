import type { Finish, SealedContent } from "@/modules/catalog";
import { assertNever, Cents } from "@/shared/kernel";

// What a sealed product's contents are worth on average (design doc 27, section 3.2). Pure: the
// valuation gathers every pack's, deck's and card's value first, then this walks the tree.

/** The values the walk needs, already gathered. Cents, fractional for packs (averages). */
export type ValueSources = Readonly<{
  /** A pack's average value, or null when its recipe is missing. */
  pack(setCode: string, boosterType: string): number | null;
  /** A card's market price in that finish; 0 when unpriced. */
  card(printingId: string, finish: Finish): number;
  /** A deck list's total value, or null when the list is missing. */
  deck(setCode: string, deckName: string): number | null;
  /** A nested product's contents, or null when it's missing from the catalog. */
  product(productId: string): readonly SealedContent[] | null;
}>;

export type ContentsValue = Readonly<{
  /** Rounded down to the cent. */
  value: Cents;
  /** Some part couldn't be valued (a missing recipe, deck or product) and counted as $0. */
  isPartial: boolean;
}>;

/** How deep products may nest: real ones go 3 levels (case → box → pack). Deeper is a loop. */
const MAX_DEPTH = 10;

type Running = { cents: number; isPartial: boolean };

/**
 * The average value of these contents. A "variable" content is the average of its options,
 * since opening picks one of them uniformly at random (inventory's `unpack`). A product that
 * contains itself is a defect in the data, so it throws.
 */
export function contentsValue(
  contents: readonly SealedContent[],
  sources: ValueSources,
): ContentsValue {
  function walk(items: readonly SealedContent[], depth: number): Running {
    if (depth > MAX_DEPTH) throw new Error("sealed product contents nest too deep (a loop?)");
    const running: Running = { cents: 0, isPartial: false };
    function add(part: Running, times = 1) {
      running.cents += part.cents * times;
      running.isPartial ||= part.isPartial;
    }
    function known(cents: number | null): Running {
      return cents === null ? { cents: 0, isPartial: true } : { cents, isPartial: false };
    }

    for (const item of items) {
      switch (item.kind) {
        case "pack":
          add(known(sources.pack(item.setCode, item.boosterType)));
          break;
        case "card":
          add({ cents: sources.card(item.printingId, item.finish), isPartial: false });
          break;
        case "deck":
          add(known(sources.deck(item.setCode, item.deckName)));
          break;
        case "sealed": {
          const nested = sources.product(item.productId);
          add(
            nested === null ? { cents: 0, isPartial: true } : walk(nested, depth + 1),
            item.count,
          );
          break;
        }
        case "variable": {
          if (item.options.length === 0) break;
          const options = item.options.map((option) => walk(option, depth));
          for (const option of options) add(option, 1 / options.length);
          break;
        }
        case "other":
          break;
        default:
          assertNever(item);
      }
    }
    return running;
  }

  const total = walk(contents, 0);
  // Averages are fractions of a cent; rounding to a millionth first keeps float noise (199.999…
  // for an exact 200) from losing a cent.
  const cents = Math.floor(Math.round(total.cents * 1e6) / 1e6);
  return { value: Cents.of(cents), isPartial: total.isPartial };
}

/** Everything some contents refer to, so a valuation can gather it before walking. */
export type ContentReferences = {
  packs: Map<string, Readonly<{ setCode: string; boosterType: string }>>;
  decks: Map<string, Readonly<{ setCode: string; deckName: string }>>;
  printingIds: Set<string>;
  productIds: Set<string>;
};

export function emptyReferences(): ContentReferences {
  return { packs: new Map(), decks: new Map(), printingIds: new Set(), productIds: new Set() };
}

/** "SET/type" and "SET/deck name": the keys the gathered values are kept under. */
export const packKey = (setCode: string, boosterType: string) => `${setCode}/${boosterType}`;
export const deckKey = (setCode: string, deckName: string) => `${setCode}/${deckName}`;

/** Adds what these contents refer to (in every variable option) to `into`. */
export function collectReferences(
  contents: readonly SealedContent[],
  into: ContentReferences,
): ContentReferences {
  for (const item of contents) {
    switch (item.kind) {
      case "pack":
        into.packs.set(packKey(item.setCode, item.boosterType), item);
        break;
      case "card":
        into.printingIds.add(item.printingId);
        break;
      case "deck":
        into.decks.set(deckKey(item.setCode, item.deckName), item);
        break;
      case "sealed":
        into.productIds.add(item.productId);
        break;
      case "variable":
        for (const option of item.options) collectReferences(option, into);
        break;
      case "other":
        break;
      default:
        assertNever(item);
    }
  }
  return into;
}
