import type { Actor } from "@/modules/accounts";
import { ok, type Result } from "@/shared/kernel";
import { type Finish, type CardFacts, type CardIdentity } from "@/shared/mtg";

// Looking cards up by name or id for a player: the card itself, its price trend and store
// printings, and what the player has of it (audit S1: the get_cards tool and any page that
// answers the same question). What belongs to other modules (copies, decks, wishes) comes
// through ports wired in src/server/composition/capabilities.ts.

export type FoundCard = CardIdentity &
  Pick<CardFacts, "name" | "typeLine" | "manaCost"> &
  Readonly<{
    colorIdentity: readonly string[];
  }>;

export type CopyOfPrinting = Readonly<{
  printingId: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
  quantity: number;
}>;

export type PricePointOf = Readonly<{ day: string; price: number }>;

export type StorePrintingOf = Readonly<{
  printingId: string;
  set: string;
  number: string;
  variant: string;
  prices: Readonly<Record<string, number>>;
}>;

export type CardLookupReaders = Readonly<{
  find(query: string): Promise<FoundCard | null>;
  findMany?(queries: readonly string[]): Promise<Map<string, FoundCard>>;
  detail(printingId: string): Promise<{
    card: { faces: readonly unknown[] };
    setCode: string;
    setName: string;
  } | null>;
  history(printingId: string): Promise<Partial<Record<string, readonly PricePointOf[]>>>;
  ownedOfPrinting(actor: Actor, printingId: string): Promise<Partial<Record<Finish, number>>>;
  gameCopies(actor: Actor, oracleId: string): Promise<readonly CopyOfPrinting[]>;
  realCopies(actor: Actor, oracleId: string): Promise<readonly CopyOfPrinting[]>;
  decksUsing(
    actor: Actor,
    printingId: string,
  ): Promise<readonly { id: number; name: string; quantity: number }[]>;
  decksUsingMany?(
    actor: Actor,
    printingIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly { id: number; name: string; quantity: number }[]>>;
  wishes(actor: Actor, printingId: string): Promise<readonly { id: unknown; quantity: number }[]>;
  storePrintings(actor: Actor, name: string): Promise<readonly StorePrintingOf[]>;
  sets?(oracleId: string): Promise<readonly string[]>;
}>;

export type CardLookup =
  | Readonly<{ query: string; found: false }>
  | Readonly<{
      query: string;
      found: true;
      card: FoundCard;
      faces: readonly unknown[];
      set: Readonly<{ code: string; name: string }> | null;
      priceTrend: ReadonlyArray<
        Readonly<{
          finish: string;
          first: { day: string; price: number } | null;
          latest: { day: string; price: number } | null;
          low: number | null;
          high: number | null;
        }>
      >;
      owned: Readonly<{
        total: number;
        game: number;
        real: number;
        printings: ReadonlyArray<CopyOfPrinting & Readonly<{ source: "game" | "real" }>>;
      }>;
      ownedOfThisPrinting: Partial<Record<Finish, number>>;
      decksUsing: readonly { id: number; name: string; quantity: number }[];
      wishes: readonly { id: unknown; quantity: number }[];
      printingsForSale: readonly StorePrintingOf[];
      sets?: readonly string[];
    }>;

type LookUpFlags = Readonly<{
  includeSets: boolean;
  includeHistory: boolean;
  includeStorePrintings: boolean;
  includeOwnedOfPrinting: boolean;
}>;

export function makeCardLookup(readers: CardLookupReaders) {
  async function lookUpOne(
    actor: Actor,
    query: string,
    card: FoundCard | null,
    preloadedDecks: readonly { id: number; name: string; quantity: number }[] | null,
    flags: LookUpFlags,
  ): Promise<CardLookup> {
    if (card === null) return { query, found: false };
    const [
      detail,
      history,
      ownedOfThisPrinting,
      game,
      real,
      decksUsing,
      wishes,
      printingsForSale,
      sets,
    ] = await Promise.all([
      readers.detail(card.printingId),
      flags.includeHistory
        ? readers.history(card.printingId)
        : Promise.resolve<Partial<Record<string, readonly PricePointOf[]>>>({}),
      flags.includeOwnedOfPrinting
        ? readers.ownedOfPrinting(actor, card.printingId)
        : Promise.resolve<Partial<Record<Finish, number>>>({}),
      readers.gameCopies(actor, card.oracleId),
      readers.realCopies(actor, card.oracleId),
      preloadedDecks !== null
        ? Promise.resolve(preloadedDecks)
        : readers.decksUsing(actor, card.printingId),
      readers.wishes(actor, card.printingId),
      flags.includeStorePrintings
        ? readers.storePrintings(actor, card.name)
        : Promise.resolve<readonly StorePrintingOf[]>([]),
      flags.includeSets && readers.sets ? readers.sets(card.oracleId) : Promise.resolve(undefined),
    ]);
    const sum = (copies: readonly CopyOfPrinting[]) =>
      copies.reduce((total, copy) => total + copy.quantity, 0);
    const resolvedSets = flags.includeSets
      ? (sets ?? [...new Set(printingsForSale.map((printing) => printing.set))].sort())
      : undefined;
    return {
      query,
      found: true,
      card,
      faces: detail?.card.faces ?? [],
      set: detail === null ? null : { code: detail.setCode, name: detail.setName },
      priceTrend: Object.entries(history).map(([finish, points = []]) => {
        const prices = points.map((point) => point.price);
        const first = points[0];
        const latest = points[points.length - 1];
        return {
          finish,
          first: first === undefined ? null : { day: first.day, price: first.price },
          latest: latest === undefined ? null : { day: latest.day, price: latest.price },
          low: prices.length === 0 ? null : Math.min(...prices),
          high: prices.length === 0 ? null : Math.max(...prices),
        };
      }),
      owned: {
        total: sum(game) + sum(real),
        game: sum(game),
        real: sum(real),
        printings: [
          ...game.map((copy) => ({ ...copy, source: "game" as const })),
          ...real.map((copy) => ({ ...copy, source: "real" as const })),
        ],
      },
      ownedOfThisPrinting,
      decksUsing,
      wishes,
      printingsForSale,
      ...(resolvedSets !== undefined ? { sets: resolvedSets } : {}),
    };
  }

  async function lookUpCards(
    actor: Actor,
    request: Readonly<{
      queries: readonly string[];
      includeSets?: boolean;
      includeHistory?: boolean;
      includeStorePrintings?: boolean;
      includeOwnedOfPrinting?: boolean;
    }>,
  ): Promise<Result<CardLookup[], never>> {
    const flags: LookUpFlags = {
      includeSets: request.includeSets ?? false,
      includeHistory: request.includeHistory ?? true,
      includeStorePrintings: request.includeStorePrintings ?? true,
      includeOwnedOfPrinting: request.includeOwnedOfPrinting ?? true,
    };
    const foundByQuery = readers.findMany
      ? await readers.findMany(request.queries)
      : new Map(
          (
            await Promise.all(
              request.queries.map(async (query) => [query, await readers.find(query)] as const),
            )
          ).filter((entry): entry is readonly [string, FoundCard] => entry[1] !== null),
        );
    const foundPrintingIds = [
      ...new Set(
        request.queries
          .map((query) => foundByQuery.get(query)?.printingId)
          .filter((printingId): printingId is string => printingId !== undefined),
      ),
    ];
    const decksByPrinting = readers.decksUsingMany
      ? foundPrintingIds.length > 0
        ? await readers.decksUsingMany(actor, foundPrintingIds)
        : new Map<string, readonly { id: number; name: string; quantity: number }[]>()
      : null;
    return ok(
      await Promise.all(
        request.queries.map((query) => {
          const card = foundByQuery.get(query) ?? null;
          const preloadedDecks =
            card !== null && decksByPrinting !== null
              ? (decksByPrinting.get(card.printingId) ?? [])
              : null;
          return lookUpOne(actor, query, card, preloadedDecks, flags);
        }),
      ),
    );
  }
  return lookUpCards;
}
