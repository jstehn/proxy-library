import {
  PrintingId,
  SealedProductId,
  SetCode,
  type Finish,
  type SealedContent,
} from "@/modules/catalog";
import type { CardGain } from "@/modules/collection";
import { valueBooster } from "@/modules/packs";
import { ok, type Result } from "@/shared/kernel";
import {
  collectReferences,
  contentsValue,
  deckKey,
  emptyReferences,
  packKey,
  type ValueSources,
} from "../domain/contents-value";
import type { ProductValue, StoreDependencies, StoreServices } from "./ports";

// Valuing every sealed product's contents (design doc 27, section 5), so no product sells for
// less than its contents sell back for (ADR 0021). The worker runs it after each price sync.

export type ValuationReport = Readonly<{
  products: number;
  /** Products with something that couldn't be valued (counted as $0). */
  partial: number;
  priceDay: string;
}>;

/** How many levels of nested products to fetch: real ones go 3 deep (case → box → pack). */
const MAX_NESTING = 10;

/** Works out every listed product's contents value from today's prices and stores them. */
async function valueAll(services: StoreServices, priceDay: string, now: Date) {
  const { productValues, productCatalog, boosters } = services;
  const listed = await productValues.listedProductIds();

  // The products, then the products inside them, level by level.
  const contentsById = new Map<string, readonly SealedContent[]>();
  let wanted: SealedProductId[] = listed;
  for (let level = 0; level < MAX_NESTING && wanted.length > 0; level++) {
    const found = await productCatalog.products(wanted);
    for (const [id, product] of found) contentsById.set(id, product.contents);
    const nested = emptyReferences();
    for (const id of wanted) collectReferences(contentsById.get(id) ?? [], nested);
    wanted = [...nested.productIds]
      .filter((id) => !contentsById.has(id))
      .map((id) => SealedProductId.of(id));
  }
  const references = emptyReferences();
  for (const contents of contentsById.values()) collectReferences(contents, references);

  // Every pack's average value, and every deck list's cards.
  const packValues = new Map<string, number | null>();
  for (const [key, pack] of references.packs) {
    packValues.set(
      key,
      await valueBooster(services, {
        setCode: SetCode.of(pack.setCode),
        boosterType: pack.boosterType,
      }),
    );
  }
  const deckCards = new Map<string, readonly CardGain[] | null>();
  for (const [key, deck] of references.decks) {
    const found = await productCatalog.deckCards(SetCode.of(deck.setCode), deck.deckName);
    deckCards.set(key, found?.cards ?? null);
    for (const card of found?.cards ?? []) references.printingIds.add(card.printingId);
  }
  const facts = await boosters.printingFacts(
    [...references.printingIds].map((id) => PrintingId.of(id)),
  );
  const priceOf = (printingId: string, finish: Finish): number =>
    facts.get(PrintingId.of(printingId))?.marketPrice[finish] ?? 0;

  const sources: ValueSources = {
    pack: (setCode, boosterType) => packValues.get(packKey(setCode, boosterType)) ?? null,
    card: priceOf,
    deck(setCode, deckName) {
      const cards = deckCards.get(deckKey(setCode, deckName));
      if (cards === undefined || cards === null) return null;
      return cards.reduce(
        (sum, card) => sum + card.quantity * priceOf(card.printingId, card.finish),
        0,
      );
    },
    product: (productId) => contentsById.get(productId) ?? null,
  };

  const values: ProductValue[] = listed.flatMap((productId) => {
    const contents = contentsById.get(productId);
    if (contents === undefined) return [];
    return [{ productId, ...contentsValue(contents, sources) }];
  });
  await productValues.replaceAll(values, priceDay, now);
  return {
    products: values.length,
    partial: values.filter((value) => value.isPartial).length,
    priceDay,
  };
}

export function makeValueProducts(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  /** Values every listed product now. Null when there are no prices yet. */
  async function valueProducts(): Promise<ValuationReport | null> {
    const result = await unitOfWork.run<ValuationReport | null, never>(async (services) => {
      const priceDay = await services.productValues.newestPriceDay();
      if (priceDay === null) return ok(null);
      return ok(await valueAll(services, priceDay, clock.now()));
    });
    return unwrap(result);
  }

  /**
   * Values every listed product if the stored values are older than the newest prices (or there
   * are none). The worker calls this every 30 seconds; it does nothing most of the time.
   */
  async function valueProductsIfStale(): Promise<ValuationReport | null> {
    const result = await unitOfWork.run<ValuationReport | null, never>(async (services) => {
      const newest = await services.productValues.newestPriceDay();
      const valued = await services.productValues.valuedPriceDay();
      if (newest === null || newest === valued) return ok(null);
      return ok(await valueAll(services, newest, clock.now()));
    });
    return unwrap(result);
  }

  return { valueProducts, valueProductsIfStale };
}

function unwrap<Value>(result: Result<Value, never>): Value {
  if (!result.ok) throw new Error("a valuation can't fail as an expected error");
  return result.value;
}
