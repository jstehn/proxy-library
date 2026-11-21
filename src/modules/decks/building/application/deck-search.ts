import { err, ok, type Result, type UserId } from "@/shared/kernel";
import { withoutAvoidCards, type DeckPlan } from "@/modules/decks/core/client";
import type { DeckNotFound } from "@/modules/decks/core/client";

// Searching for cards for one deck (audit S1: search_cards with a deck): the synergy search
// ("Treasure makers"), and the search by meaning. Both leave out the deck's "avoid" cards and say
// which. The searches are readers; their answers pass through unchanged.

export type DeckSearchRequest = Readonly<{
  deckId: number;
  queries: ReadonlyArray<Readonly<{ synergy: string; search: string }>>;
  where: "owned" | "store" | "both";
  perQuery: number;
  maxPriceCents: number | null;
}>;

export type SemanticRequest = Readonly<{
  concept: string;
  filter?: string;
  types?: readonly string[];
  excludeTypes?: readonly string[];
  maxPriceCents?: number;
  limit?: number;
}>;

type Named = Readonly<{ name: string }>;
type Pick = Readonly<{ card: Named }>;

export type DeckSearchReaders<Found extends { cards: readonly Named[] }, Semantic> = Readonly<{
  searchForDeck(userId: UserId, request: DeckSearchRequest): Promise<Found | null>;
  semantic(userId: UserId, deckId: number, request: SemanticRequest): Promise<Semantic | null>;
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
}>;

export function makeDeckSearch<
  Found extends { cards: readonly Named[] },
  Semantic extends { owned: readonly Pick[]; store: readonly Pick[] },
>(readers: DeckSearchReaders<Found, Semantic>) {
  async function searchForDeck(
    request: Readonly<{ userId: UserId } & DeckSearchRequest>,
  ): Promise<Result<{ result: Found; cards: Found["cards"]; avoided: string[] }, DeckNotFound>> {
    const result = await readers.searchForDeck(request.userId, request);
    if (result === null) return err({ kind: "DeckNotFound" });
    const profile = await readers.profile(request.userId, request.deckId);
    const { kept, avoided } = withoutAvoidCards(result.cards, (card) => card.name, profile);
    return ok({ result, cards: kept, avoided });
  }

  async function semantic(
    request: Readonly<{ userId: UserId; deckId: number } & SemanticRequest>,
  ): Promise<
    Result<
      { result: Semantic; owned: Semantic["owned"]; store: Semantic["store"]; avoided: string[] },
      DeckNotFound
    >
  > {
    const result = await readers.semantic(request.userId, request.deckId, request);
    if (result === null) return err({ kind: "DeckNotFound" });
    const profile = await readers.profile(request.userId, request.deckId);
    const owned = withoutAvoidCards(result.owned, (pick) => pick.card.name, profile);
    const store = withoutAvoidCards(result.store, (pick) => pick.card.name, profile);
    return ok({
      result,
      owned: owned.kept,
      store: store.kept,
      avoided: [...new Set([...owned.avoided, ...store.avoided])],
    });
  }

  return { searchForDeck, semantic };
}
