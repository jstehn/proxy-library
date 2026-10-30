import type { Actor } from "@/modules/accounts";
import type { SealedProduct, SealedProductId } from "@/modules/catalog";
import { err, ok, type Result } from "@/shared/kernel";
import type { ChoiceNeeded, NotOwned, ProductNotFound, ProductUnavailable } from "../domain/errors";
import { planImport, planRemoval, type ImportPlan } from "../domain/import-plan";
import {
  contentReferences,
  realProductCards,
  type ProductCards,
  type ProductDeckList,
  type VariableChoices,
} from "../domain/product-cards";
import type { ProductContents, RealCollectionDependencies } from "./ports";

// Products owned for real (design doc 16, section 15): recording one adds its known cards.

export type AddRealProductInput = Readonly<{
  productId: SealedProductId;
  choices: VariableChoices;
}>;

/** What recording a product did: its record, its cards and decks, and what wasn't added. */
export type AddedRealProduct = Readonly<{
  realProductId: number;
  product: SealedProduct;
  cards: ProductCards;
  plan: ImportPlan;
}>;

export type AddRealProductError = ProductNotFound | ProductUnavailable | ChoiceNeeded;

export type RemoveRealProductInput = Readonly<{ realProductId: number; removeCards: boolean }>;

/** Nested products can be several levels deep, but never this deep (a loop in bad data). */
const MAX_DEPTH = 8;

/**
 * Reads everything a product refers to (nested products level by level, then precon lists) and
 * works out its known cards. Null when the product itself doesn't exist.
 */
async function loadProductCards(
  productContents: ProductContents,
  productId: SealedProductId,
  choices: VariableChoices,
): Promise<{
  product: SealedProduct;
  cards: Result<ProductCards, ProductUnavailable | ChoiceNeeded>;
} | null> {
  const products = await productContents.products([productId]);
  const product = products.get(productId);
  if (product === undefined) return null;

  const deckLists = new Map<string, ProductDeckList | null>();
  let level: readonly SealedProduct[] = [product];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
    const references = level.map((each) => contentReferences(each.contents));
    for (const deck of references.flatMap((each) => each.decks)) {
      const key = `${deck.setCode}/${deck.deckName}`;
      if (!deckLists.has(key)) {
        deckLists.set(key, await productContents.deckCards(deck.setCode, deck.deckName));
      }
    }
    const newIds = references.flatMap((each) => each.productIds).filter((id) => !products.has(id));
    const found = await productContents.products([...new Set(newIds)]);
    found.forEach((nested, id) => products.set(id, nested));
    level = [...found.values()];
  }

  const cards = realProductCards(
    product.contents,
    (id) => products.get(id) ?? null,
    (setCode, deckName) => deckLists.get(`${setCode}/${deckName}`) ?? null,
    choices,
  );
  return { product, cards };
}

export function makeRealProducts(dependencies: RealCollectionDependencies) {
  const { unitOfWork, clock } = dependencies;

  /**
   * Records a product owned for real and adds its known cards to the real collection, in one
   * transaction (rule 10). Making decks from its precons is the caller's next step (rule 11).
   */
  async function addRealProduct(
    actor: Actor,
    input: AddRealProductInput,
  ): Promise<Result<AddedRealProduct, AddRealProductError>> {
    return unitOfWork.run<AddedRealProduct, AddRealProductError>(
      async ({ realCollection, productContents }) => {
        const loaded = await loadProductCards(productContents, input.productId, input.choices);
        if (loaded === null) return err({ kind: "ProductNotFound" });
        if (!loaded.cards.ok) return loaded.cards;

        await realCollection.lock(actor.userId);
        const now = clock.now();
        const current = await realCollection.copies(actor.userId);
        const plan = planImport(current, loaded.cards.value.copies, "add");
        await realCollection.apply(actor.userId, plan, now);
        const realProductId = await realCollection.addProduct(
          actor.userId,
          input.productId,
          input.choices,
          now,
        );
        const added: AddedRealProduct = {
          realProductId,
          product: loaded.product,
          cards: loaded.cards.value,
          plan,
        };
        return ok(added);
      },
    );
  }

  /**
   * Deletes a real product's record (rule 13). With `removeCards`, its known cards are taken out
   * of the real collection too, never below 0. Decks made from it are left alone.
   */
  async function removeRealProduct(
    actor: Actor,
    input: RemoveRealProductInput,
  ): Promise<Result<ImportPlan, NotOwned | ProductUnavailable | ChoiceNeeded>> {
    return unitOfWork.run<ImportPlan, NotOwned | ProductUnavailable | ChoiceNeeded>(
      async ({ realCollection, productContents }) => {
        const owned = await realCollection.findProduct(input.realProductId, actor.userId);
        if (owned === null) return err({ kind: "NotOwned" });
        await realCollection.lock(actor.userId);

        let plan = planRemoval([], []);
        if (input.removeCards) {
          const loaded = await loadProductCards(productContents, owned.productId, owned.choices);
          if (loaded === null) return err({ kind: "ProductUnavailable" });
          if (!loaded.cards.ok) return loaded.cards;
          plan = planRemoval(await realCollection.copies(actor.userId), loaded.cards.value.copies);
          await realCollection.apply(actor.userId, plan, clock.now());
        }
        await realCollection.removeProduct(owned.id);
        return ok(plan);
      },
    );
  }

  return { addRealProduct, removeRealProduct };
}
