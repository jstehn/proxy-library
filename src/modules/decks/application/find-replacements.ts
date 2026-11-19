import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { DeckPlan } from "../domain/deck-profile";
import { withoutAvoidCards } from "../domain/deck-profile";
import type { CardNotFound, DeckNotFound } from "../domain/errors";
import type {
  BudgetReplacementsResult,
  Suggestion,
  SuggestionList,
} from "../domain/suggestion-types";

// Replacements for a card: cards that do what it does, and cheaper cards with similar text
// (audit S1: the find_replacements tool and the builder's similar and budget panels). The
// searches themselves are readers; this decides what's left out (the deck's avoid list).

export type FindReplacementsReaders = Readonly<{
  findCard(nameOrId: string): Promise<Readonly<{ oracleId: string; name: string }> | null>;
  similar(userId: UserId, deckId: number, oracleId: string): Promise<SuggestionList | null>;
  budget(
    userId: UserId,
    deckId: number,
    options: Readonly<{ oracleId?: string; minPriceCents?: number; maxPriceCents?: number }>,
  ): Promise<BudgetReplacementsResult | null>;
  /** The deck's stored profile, or null when it has none. */
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
}>;

export type SimilarCards = Readonly<{
  like: string;
  owned: readonly Suggestion[];
  store: readonly Suggestion[];
  hiddenOverTarget: number;
  /** Cards left out because the deck's profile says to avoid them, once each. */
  avoided: readonly string[];
}>;

export function makeFindReplacements(readers: FindReplacementsReaders) {
  async function similarTo(
    request: Readonly<{ userId: UserId; deckId: number; card: string }>,
  ): Promise<Result<SimilarCards, CardNotFound | DeckNotFound>> {
    const found = await readers.findCard(request.card);
    if (found === null) return err({ kind: "CardNotFound" });
    const result = await readers.similar(request.userId, request.deckId, found.oracleId);
    if (result === null) return err({ kind: "DeckNotFound" });
    const profile = await readers.profile(request.userId, request.deckId);
    const owned = withoutAvoidCards(result.owned, (each) => each.card.name, profile);
    const store = withoutAvoidCards(result.store, (each) => each.card.name, profile);
    return ok({
      like: found.name,
      owned: owned.kept,
      store: store.kept,
      hiddenOverTarget: result.hiddenOverTarget,
      avoided: [...new Set([...owned.avoided, ...store.avoided])],
    });
  }

  async function cheaperAlternatives(
    request: Readonly<{
      userId: UserId;
      deckId: number;
      card?: string;
      minPriceCents?: number;
      maxPriceCents?: number;
    }>,
  ): Promise<Result<BudgetReplacementsResult, CardNotFound | DeckNotFound>> {
    let oracleId: string | undefined;
    if (request.card !== undefined) {
      const found = await readers.findCard(request.card);
      if (found === null) return err({ kind: "CardNotFound" });
      oracleId = found.oracleId;
    }
    const result = await readers.budget(request.userId, request.deckId, {
      oracleId,
      minPriceCents: request.minPriceCents,
      maxPriceCents: request.maxPriceCents,
    });
    return result === null ? err({ kind: "DeckNotFound" }) : ok(result);
  }

  return { similarTo, cheaperAlternatives };
}
