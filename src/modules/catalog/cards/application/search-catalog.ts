import type { Actor } from "@/modules/accounts";
import { ok, type Finish, type Result } from "@/shared/kernel";

// Plain card search for a player (audit S1: the search_cards tool outside a deck): their game
// collection, their real cards, or everything the store sells. The searches are readers; this
// puts the two collections together and names each card.

export type CopyRow = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
  price: number | null;
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

export type SearchCatalogReaders = Readonly<{
  collection(actor: Actor, page: number, search: string): Promise<CollectionAnswer>;
  realCollection(actor: Actor, page: number, search: string): Promise<CollectionAnswer>;
  store(
    actor: Actor,
    search: string,
    page: number,
    oneRowPerCard: boolean,
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
}>;

export function makeSearchCatalog(readers: SearchCatalogReaders) {
  async function searchCatalog(
    actor: Actor,
    request: CatalogSearchRequest,
  ): Promise<Result<CatalogSearch, never>> {
    const { search, where, page } = request;
    if (where !== "store") {
      const [game, real] = await Promise.all([
        where === "real" ? null : readers.collection(actor, page, search),
        where === "game" ? null : readers.realCollection(actor, page, search),
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
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name) || (a.set ?? "").localeCompare(b.set ?? ""));
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
    const found = await readers.store(actor, search, page, request.oneRowPerCard);
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
