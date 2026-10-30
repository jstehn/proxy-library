import {
  PrintingId,
  SealedProductId,
  SetCode,
  type Finish,
  type SealedProduct,
} from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";
import type {
  CollectionVersion,
  PrintingFacts,
  PrintingMatcher,
  ProductContents,
  RealCollectionRepository,
  RealProduct,
} from "../application/ports";
import { applyPlan } from "../domain/import-plan";
import type { RealCopy } from "../domain/copies";
import { normalizedName, type PrintingCandidate } from "../domain/match";
import type { ProductDeckList } from "../domain/product-cards";

// In-memory test doubles for the real collection's ports.

/** A copy for tests: `realCopy("a", 2)` is two nonfoil copies of printing "a". */
export function realCopy(
  printingId: string,
  quantity: number,
  finish: Finish = "nonfoil",
): RealCopy {
  return { printingId: PrintingId.of(printingId), finish, quantity };
}

/** Ids for tests, so domain tests needn't import the catalog's constructors. */
export const samplePrintingId = (id: string) => PrintingId.of(id);
export const sampleProductId = (id: string) => SealedProductId.of(id);
export const sampleSetCode = (code: string) => SetCode.of(code);

/** A printing for the fake matcher; everything not given is an ordinary nonfoil/foil card. */
export function candidate(
  fields: Partial<Omit<PrintingCandidate, "printingId">> & { printingId: string; name?: string },
): PrintingCandidate & { name: string; scryfallId: string } {
  return {
    oracleId: `oracle-${fields.name ?? fields.printingId}`,
    setCode: "BLB",
    collectorNumber: "1",
    setType: "expansion",
    releaseDate: "2024-08-02",
    finishes: ["nonfoil", "foil"],
    borderColor: "black",
    frameEffects: [],
    promoTypes: [],
    isFullArt: false,
    scryfallId: `scryfall-${fields.printingId}`,
    ...fields,
    name: fields.name ?? fields.printingId,
    printingId: PrintingId.of(fields.printingId),
  };
}

/** The real collection in memory. `rows`, `products` and `settings` are for assertions. */
export function inMemoryRealCollectionRepository() {
  const rows = new Map<UserId, RealCopy[]>();
  const updatedAt = new Map<UserId, string>();
  const products: RealProduct[] = [];
  const settings = new Map<UserId, boolean>();
  let nextProductId = 1;

  const copiesOf = (userId: UserId) => rows.get(userId) ?? [];
  const touch = (userId: UserId, at: Date) => updatedAt.set(userId, at.toISOString());

  const repository: RealCollectionRepository = {
    async lock() {},
    async copies(userId) {
      return copiesOf(userId);
    },
    async version(userId): Promise<CollectionVersion> {
      return { updatedAt: updatedAt.get(userId) ?? null, rows: copiesOf(userId).length };
    },
    async set(userId, copy, at) {
      const others = copiesOf(userId).filter(
        (each) => each.printingId !== copy.printingId || each.finish !== copy.finish,
      );
      rows.set(userId, copy.quantity === 0 ? others : [...others, copy]);
      touch(userId, at);
    },
    async apply(userId, plan, at) {
      rows.set(userId, applyPlan(copiesOf(userId), plan));
      touch(userId, at);
    },
    async clear(userId) {
      const count = copiesOf(userId).length;
      rows.delete(userId);
      return count;
    },
    async setShared(userId, isShared) {
      settings.set(userId, isShared);
    },
    async addProduct(userId, productId, choices) {
      const id = nextProductId++;
      products.push({ id, userId, productId, choices });
      return id;
    },
    async findProduct(realProductId, userId) {
      return products.find((each) => each.id === realProductId && each.userId === userId) ?? null;
    },
    async removeProduct(realProductId) {
      const index = products.findIndex((each) => each.id === realProductId);
      if (index >= 0) products.splice(index, 1);
    },
  };
  return { ...repository, rows, products, settings };
}

/** A matcher over a fixed list of printings. */
export function fakePrintingMatcher(
  printings: ReadonlyArray<PrintingCandidate & { name: string; scryfallId: string }>,
): PrintingMatcher {
  return {
    async candidates() {
      const byName = new Map<string, PrintingCandidate[]>();
      for (const printing of printings) {
        const key = normalizedName(printing.name);
        byName.set(key, [...(byName.get(key) ?? []), printing]);
      }
      const byScryfallId = new Map(printings.map((printing) => [printing.scryfallId, printing]));
      return { byName, byScryfallId };
    },
    async facts(printingIds) {
      const facts = new Map<PrintingId, PrintingFacts>();
      for (const printing of printings) {
        if (printingIds.includes(printing.printingId)) {
          facts.set(printing.printingId, {
            oracleId: printing.oracleId,
            finishes: printing.finishes,
          });
        }
      }
      return facts;
    },
  };
}

/** Products and precon lists in memory, keyed like the catalog ("SOC/Silverquill Influence"). */
export function fakeProductContents(
  products: readonly SealedProduct[],
  decks: Readonly<Record<string, ProductDeckList>>,
): ProductContents {
  return {
    async products(productIds) {
      const found = new Map<SealedProductId, SealedProduct>();
      for (const product of products)
        if (productIds.includes(product.id)) found.set(product.id, product);
      return found;
    },
    async deckCards(setCode, deckName) {
      return decks[`${setCode}/${deckName}`] ?? null;
    },
  };
}
