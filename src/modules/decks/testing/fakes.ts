import { PrintingId } from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";
import type { CardLookup, CardQuery, DeckRepository, ResolvedCard } from "../application/ports";
import { DeckId, type Deck } from "../domain/deck";

// In-memory stand-ins for the decks ports.

export function inMemoryDeckRepository() {
  const decks = new Map<DeckId, Deck>();
  let lastId = 0;

  const repository: DeckRepository = {
    async create(input) {
      const id = DeckId.of(++lastId);
      decks.set(id, {
        id,
        ownerId: input.ownerId,
        name: input.name,
        format: input.format,
        entries: [],
      });
      return id;
    },
    async countFor(ownerId) {
      return [...decks.values()].filter((deck) => deck.ownerId === ownerId).length;
    },
    async lockOwned(deckId, ownerId) {
      const deck = decks.get(deckId);
      return deck !== undefined && deck.ownerId === ownerId ? deck : null;
    },
    async save(deck) {
      decks.set(deck.id, deck);
    },
    async delete(deckId) {
      decks.delete(deckId);
    },
    async deleteAllOf(ownerId) {
      const owned = [...decks.values()].filter((deck) => deck.ownerId === ownerId);
      for (const deck of owned) decks.delete(deck.id);
      return owned.length;
    },
  };
  return { ...repository, get: (deckId: DeckId) => decks.get(deckId) };
}

export type SampleCard = { oracleId: string; name: string; printingId: string };

/** Cards the catalog "has", found by exact name (front face of "A // B" too). */
export function inMemoryCardLookup(cards: readonly SampleCard[]): CardLookup {
  return {
    async exists(oracleId) {
      return cards.some((card) => card.oracleId === oracleId);
    },
    async oracleIdsOf(printingIds) {
      const found = new Map<PrintingId, string>();
      for (const card of cards) {
        const printingId = PrintingId.of(card.printingId);
        if (printingIds.includes(printingId)) found.set(printingId, card.oracleId);
      }
      return found;
    },
    async resolve(_ownerId: UserId, queries: readonly CardQuery[]) {
      const found = new Map<number, ResolvedCard>();
      queries.forEach((query, index) => {
        const card = cards.find(
          (candidate) =>
            candidate.name.toLowerCase() === query.name.toLowerCase() ||
            candidate.name.split(" // ")[0].toLowerCase() === query.name.toLowerCase(),
        );
        if (card !== undefined) {
          found.set(index, {
            oracleId: card.oracleId,
            printingId: PrintingId.of(card.printingId),
            finish: "nonfoil",
          });
        }
      });
      return found;
    },
  };
}

/** A printing id for tests (domain code may only import catalog types, not its constructors). */
export function samplePrintingId(raw: string): PrintingId {
  return PrintingId.of(raw);
}
