import type {
  Finish,
  PrintingId,
  SealedProduct,
  SealedProductId,
  SetCode,
} from "@/modules/catalog";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { RealCopy, RealCopyKey } from "../domain/copies";
import type { ImportPlan } from "../domain/import-plan";
import type { CatalogMatches } from "../domain/match";
import type { ProductDeckList, VariableChoices } from "../domain/product-cards";
import type { ImportLine } from "../domain/readers";

// Ports: what the real collection's use cases need from outside (design doc 16, section 8).

/**
 * Rule 6: what the collection looked like when a preview was made. Any change (a new row, a
 * deleted one, a new quantity) changes it.
 */
export type CollectionVersion = Readonly<{ updatedAt: string | null; rows: number }>;

/** A real product as recorded (section 15). */
export type RealProduct = Readonly<{
  id: number;
  userId: UserId;
  productId: SealedProductId;
  choices: VariableChoices;
}>;

export interface RealCollectionRepository {
  /**
   * Holds this player's real collection until the transaction ends, so two tabs can't change it
   * at once (rule 6). Every write below runs after it.
   */
  lock(userId: UserId): Promise<void>;
  copies(userId: UserId): Promise<RealCopy[]>;
  version(userId: UserId): Promise<CollectionVersion>;
  /** Sets one row's quantity; 0 deletes it. */
  set(userId: UserId, copy: RealCopy, at: Date): Promise<void>;
  apply(userId: UserId, plan: ImportPlan, at: Date): Promise<void>;
  /** Deletes every row. Returns how many. */
  clear(userId: UserId): Promise<number>;
  setShared(userId: UserId, isShared: boolean, at: Date): Promise<void>;
  addProduct(
    userId: UserId,
    productId: SealedProductId,
    choices: VariableChoices,
    at: Date,
  ): Promise<number>;
  /** The real product, if it exists and belongs to this player. */
  findProduct(realProductId: number, userId: UserId): Promise<RealProduct | null>;
  removeProduct(realProductId: number): Promise<void>;
}

/** What a printing is, for checking a row: its card and the finishes it comes in. */
export type PrintingFacts = Readonly<{ oracleId: string; finishes: readonly Finish[] }>;

/** Reads the catalog's printings (CQRS-lite: its tables, not its code). */
export interface PrintingMatcher {
  /** Every printing the lines could mean, read in one query for the whole import. */
  candidates(lines: readonly ImportLine[]): Promise<CatalogMatches>;
  /** Facts about these printings; unknown ids are missing from the map. */
  facts(printingIds: readonly PrintingId[]): Promise<Map<PrintingId, PrintingFacts>>;
}

/** Sealed products and precon lists from the catalog (the same reads inventory makes). */
export interface ProductContents {
  products(productIds: readonly SealedProductId[]): Promise<Map<SealedProductId, SealedProduct>>;
  deckCards(setCode: SetCode, deckName: string): Promise<ProductDeckList | null>;
}

export type RealCollectionServices = {
  realCollection: RealCollectionRepository;
  printingMatcher: PrintingMatcher;
  productContents: ProductContents;
};

export type RealCollectionDependencies = {
  unitOfWork: UnitOfWork<RealCollectionServices>;
  clock: Clock;
};

export type { RealCopyKey };
