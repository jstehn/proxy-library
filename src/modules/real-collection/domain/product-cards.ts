import type {
  Finish,
  PrintingId,
  SealedContent,
  SealedProduct,
  SealedProductId,
  SetCode,
} from "@/modules/catalog";
import type { ListSection } from "@/shared/card-search";
import { assertNever, err, ok, type Result } from "@/shared/kernel";
import { sumCopies, type RealCopy } from "./copies";
import type { ChoiceNeeded, ProductUnavailable } from "./errors";

// What a real product puts in your hands (design doc 16, section 15). It walks the same tree as
// inventory's unpacking (design doc 06), but all the way down at once and without an Rng: the
// contents are what's in the box, not a random draw.

/** One card of a precon's list: copies, a finish, and which board they go on. */
export type ProductDeckCard = Readonly<{
  printingId: PrintingId;
  finish: Finish;
  quantity: number;
  board: ListSection;
}>;

/** A precon's list as the catalog holds it. */
export type ProductDeckList = Readonly<{ type: string; cards: readonly ProductDeckCard[] }>;

/** A precon inside the product, to make a deck from (rule 11). */
export type ProductDeck = Readonly<{
  name: string;
  type: string;
  cards: readonly ProductDeckCard[];
}>;

/** The product's known cards, its precons, and what wasn't added (rule 12). */
export type ProductCards = Readonly<{
  /** Summed by printing and finish, across every deck and loose card. */
  copies: readonly RealCopy[];
  decks: readonly ProductDeck[];
  /** "Bloomburrow Play Booster", "Spindown": not known, or not cards. */
  notAdded: readonly string[];
}>;

/** Which option the player got for each "variable" node, in the order they're met. */
export type VariableChoices = readonly number[];

/** Nested products, by id, and precon lists, by set and name (null when the catalog lacks one). */
export type ProductLookup = (productId: SealedProductId) => SealedProduct | null;
export type DeckLookup = (setCode: string, deckName: string) => ProductDeckList | null;

/** The products and decks a product's contents refer to, one level down, every option included. */
export function contentReferences(contents: readonly SealedContent[]): {
  productIds: SealedProductId[];
  decks: Array<{ setCode: SetCode; deckName: string }>;
} {
  const productIds: SealedProductId[] = [];
  const decks: Array<{ setCode: SetCode; deckName: string }> = [];
  function visit(content: SealedContent): void {
    switch (content.kind) {
      case "sealed":
        productIds.push(content.productId);
        return;
      case "deck":
        decks.push({ setCode: content.setCode, deckName: content.deckName });
        return;
      case "variable":
        content.options.forEach((option) => option.forEach(visit));
        return;
      case "pack":
      case "card":
      case "other":
        return;
      default:
        return assertNever(content);
    }
  }
  contents.forEach(visit);
  return { productIds, decks };
}

/** A short name for one option of a variable node: its decks, products and packs. */
function optionLabel(option: readonly SealedContent[], products: ProductLookup): string {
  const parts = option.map((content) => {
    switch (content.kind) {
      case "deck":
        return content.deckName;
      case "sealed":
        return products(content.productId)?.name ?? "a product";
      case "pack":
        return `${content.setCode} ${content.boosterType} booster`;
      case "card":
        return "a card";
      case "other":
        return content.name;
      case "variable":
        return "one of several";
      default:
        return assertNever(content);
    }
  });
  return parts.join(" + ");
}

/**
 * Everything a real product contains that we know: a deck's whole list, loose cards, and the
 * same for nested products (`count` times). Packs and other things are listed as not added.
 * Each "variable" node takes the next of `choices`; until every one is made, the result says
 * which choice is needed.
 */
export function realProductCards(
  contents: readonly SealedContent[],
  products: ProductLookup,
  decks: DeckLookup,
  choices: VariableChoices,
): Result<ProductCards, ProductUnavailable | ChoiceNeeded> {
  const copies: RealCopy[] = [];
  const foundDecks: ProductDeck[] = [];
  const notAdded: string[] = [];
  let choicesUsed = 0;
  let problem: ProductUnavailable | ChoiceNeeded | null = null;

  function visit(content: SealedContent): void {
    if (problem !== null) return;
    switch (content.kind) {
      case "card":
        copies.push({ printingId: content.printingId, finish: content.finish, quantity: 1 });
        return;
      case "deck": {
        const list = decks(content.setCode, content.deckName);
        if (list === null) {
          problem = { kind: "ProductUnavailable" };
          return;
        }
        copies.push(...list.cards);
        foundDecks.push({ name: content.deckName, type: list.type, cards: list.cards });
        return;
      }
      case "sealed": {
        const product = products(content.productId);
        if (product === null) {
          problem = { kind: "ProductUnavailable" };
          return;
        }
        for (let copy = 0; copy < content.count; copy++) product.contents.forEach(visit);
        return;
      }
      case "pack":
        notAdded.push(`${content.setCode} ${content.boosterType} booster`);
        return;
      case "other":
        notAdded.push(content.name);
        return;
      case "variable": {
        const index = choicesUsed++;
        const chosen = choices[index];
        const option = chosen === undefined ? undefined : content.options[chosen];
        if (option === undefined) {
          const options = content.options.map((each) => optionLabel(each, products));
          problem = { kind: "ChoiceNeeded", index, options };
          return;
        }
        option.forEach(visit);
        return;
      }
      default:
        return assertNever(content);
    }
  }

  contents.forEach(visit);
  if (problem !== null) return err(problem);
  const result: ProductCards = {
    copies: sumCopies(
      copies.map(({ printingId, finish, quantity }) => ({ printingId, finish, quantity })),
    ),
    decks: foundDecks,
    notAdded,
  };
  return ok(result);
}
