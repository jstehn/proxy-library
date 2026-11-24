import type { Actor } from "@/modules/accounts";
import { ok, type Result } from "@/shared/kernel";
import { type Finish } from "@/shared/mtg";

// Plain card search for a player (audit S1: the search_cards tool outside a deck): their game
// collection, their real cards, or everything the store sells. The searches are readers; this
// puts the two collections together and names each card.

export type CatalogSearchSort = "name" | "price_desc" | "added_desc" | "mv";

export type CopyRow = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
  price: number | null;
  manaValue?: number;
  lastAcquiredAt?: Date | null;
}>;

export type CollectionAnswer = Readonly<{
  rows: readonly CopyRow[];
  notes: readonly string[];
  totals: Readonly<{ different: number; copies: number }>;
  pageCount: number;
}>;

export type PrintingFacts = Readonly<{
  name: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  faces: readonly Readonly<{ text: string }>[];
  prices: Readonly<Record<string, number | undefined>>;
}>;

export type CollectionSearchOptions = Readonly<{
  page: number;
  search: string;
  sort: CatalogSearchSort;
  addedSince?: Date;
}>;

export type StoreSearchOptions = Readonly<{
  search: string;
  page: number;
  oneRowPerCard: boolean;
  sort: CatalogSearchSort;
}>;

export type SearchCatalogReaders = Readonly<{
  collection(actor: Actor, options: CollectionSearchOptions): Promise<CollectionAnswer>;
  realCollection(actor: Actor, options: CollectionSearchOptions): Promise<CollectionAnswer>;
  store(
    actor: Actor,
    options: StoreSearchOptions,
  ): Promise<
    Readonly<{
      printingIds: readonly string[];
      notes: readonly string[];
      total: number;
      pageCount: number;
    }>
  >;
  printings(ids: readonly string[]): Promise<ReadonlyMap<string, PrintingFacts>>;
}>;

export type OwnedCardRow = Readonly<{
  name: string;
  printingId: string;
  set: string | undefined;
  finish: Finish;
  quantity: number;
  source: "game" | "real";
  text: string | undefined;
  price: number | null;
  manaValue?: number;
  lastAcquiredAt?: Date | null;
}>;

export type StoreCardRow = Readonly<{
  name: string;
  printingId: string;
  set: string;
  number: string;
  rarity: string;
  text: string;
  cheapest: number | null;
}>;

export type CatalogSearch =
  | Readonly<{
      kind: "owned";
      notes: readonly string[];
      totals: Readonly<{ cards: number; copies: number }>;
      pageCount: number;
      cards: readonly OwnedCardRow[];
    }>
  | Readonly<{
      kind: "store";
      notes: readonly string[];
      total: number;
      pageCount: number;
      cards: readonly StoreCardRow[];
    }>;

export type CatalogSearchRequest = Readonly<{
  search: string;
  where: "owned" | "game" | "real" | "store";
  page: number;
  oneRowPerCard: boolean;
  sort?: CatalogSearchSort;
  addedSince?: Date;
}>;

function compareOwnedRows(
  sort: CatalogSearchSort,
  left: OwnedCardRow,
  right: OwnedCardRow,
): number {
  const byName = () =>
    left.name.localeCompare(right.name) || (left.set ?? "").localeCompare(right.set ?? "");
  switch (sort) {
    case "price_desc": {
      const leftPrice = left.price ?? -1;
      const rightPrice = right.price ?? -1;
      return rightPrice - leftPrice || byName();
    }
    case "added_desc": {
      const leftTime = left.lastAcquiredAt?.getTime() ?? -1;
      const rightTime = right.lastAcquiredAt?.getTime() ?? -1;
      return rightTime - leftTime || byName();
    }
    case "mv": {
      const leftMana = left.manaValue ?? Number.MAX_SAFE_INTEGER;
      const rightMana = right.manaValue ?? Number.MAX_SAFE_INTEGER;
      return leftMana - rightMana || byName();
    }
    case "name":
      return byName();
  }
}

export function makeSearchCatalog(readers: SearchCatalogReaders) {
  async function searchCatalog(
    actor: Actor,
    request: CatalogSearchRequest,
  ): Promise<Result<CatalogSearch, never>> {
    const { search, where, page, addedSince } = request;
    const sort = request.sort ?? "name";
    if (where !== "store") {
      const options: CollectionSearchOptions = {
        page,
        search,
        sort,
        ...(addedSince !== undefined ? { addedSince } : {}),
      };
      const [game, real] = await Promise.all([
        where === "real" ? null : readers.collection(actor, options),
        where === "game" ? null : readers.realCollection(actor, options),
      ]);
      const rows = [
        ...(game?.rows.map((row) => ({ ...row, source: "game" as const })) ?? []),
        ...(real?.rows.map((row) => ({ ...row, source: "real" as const })) ?? []),
      ];
      const cards = await readers.printings(rows.map((row) => row.printingId));
      const named = rows
        .map((row): OwnedCardRow => {
          const card = cards.get(row.printingId);
          return {
            name: card?.name ?? "",
            printingId: row.printingId,
            set: card?.setCode,
            finish: row.finish,
            quantity: row.quantity,
            source: row.source,
            text: card?.faces.map((face) => face.text).join("\n"),
            price: row.price,
            ...(row.manaValue !== undefined ? { manaValue: row.manaValue } : {}),
            ...(row.lastAcquiredAt !== undefined ? { lastAcquiredAt: row.lastAcquiredAt } : {}),
          };
        })
        .sort((left, right) => compareOwnedRows(sort, left, right));
      return ok({
        kind: "owned",
        notes: game?.notes ?? real?.notes ?? [],
        totals: {
          cards: (game?.totals.different ?? 0) + (real?.totals.different ?? 0),
          copies: (game?.totals.copies ?? 0) + (real?.totals.copies ?? 0),
        },
        pageCount: Math.max(game?.pageCount ?? 1, real?.pageCount ?? 1),
        cards: named,
      });
    }
    const found = await readers.store(actor, {
      search,
      page,
      oneRowPerCard: request.oneRowPerCard,
      sort,
    });
    const cards = await readers.printings(found.printingIds);
    return ok({
      kind: "store",
      notes: found.notes,
      total: found.total,
      pageCount: found.pageCount,
      cards: found.printingIds.flatMap((id): StoreCardRow[] => {
        const card = cards.get(id);
        if (card === undefined) return [];
        const prices = Object.values(card.prices).filter((price) => price !== undefined);
        return [
          {
            name: card.name,
            printingId: id,
            set: card.setCode,
            number: card.collectorNumber,
            rarity: card.rarity,
            text: card.faces.map((face) => face.text).join("\n"),
            cheapest: prices.length === 0 ? null : Math.min(...(prices as number[])),
          },
        ];
      }),
    });
  }
  return searchCatalog;
}
