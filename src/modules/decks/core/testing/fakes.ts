import { PrintingId } from "@/modules/catalog";
import { type Finish, type UserId } from "@/shared/kernel";
import type { CardLookup, CardQuery, DeckRepository, ResolvedCard } from "../application/ports";
import {
  DeckId,
  canViewDeck,
  isValidPublicToken,
  type Deck,
  type Visibility,
} from "../domain/deck";
import { tidyHeadings } from "../domain/headings";

// In-memory stand-ins for the decks ports.

export function inMemoryDeckRepository() {
  const decks = new Map<DeckId, Deck>();
  const sharingMeta = new Map<DeckId, { visibility: Visibility; publicToken: string | null }>();
  let lastId = 0;

  const repository: DeckRepository = {
    async create(input) {
      const id = DeckId.of(++lastId);
      decks.set(id, {
        id,
        ownerId: input.ownerId,
        name: input.name,
        format: input.format,
        usesRealCards: input.usesRealCards ?? true,
        targetBracket: null,
        grouping: "type",
        headings: [],
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
    async findReadable(source) {
      if (source.kind === "deck") {
        const deck = decks.get(source.deckId);
        if (deck === undefined) return null;
        const visibility = sharingMeta.get(source.deckId)?.visibility ?? "private";
        return canViewDeck(source.viewerId, { ownerId: deck.ownerId, visibility }) ? deck : null;
      }
      if (!isValidPublicToken(source.token)) return null;
      for (const [id, meta] of sharingMeta) {
        if (meta.publicToken === source.token) return decks.get(id) ?? null;
      }
      return null;
    },
    async save(deck) {
      decks.set(deck.id, tidyHeadings(deck));
    },
    async delete(deckId) {
      decks.delete(deckId);
    },
    async deleteAllOf(ownerId) {
      const owned = [...decks.values()].filter((deck) => deck.ownerId === ownerId);
      for (const deck of owned) {
        decks.delete(deck.id);
      }
      return owned.length;
    },
  };
  return {
    ...repository,
    setSharing(deckId: DeckId, meta: { visibility?: Visibility; publicToken?: string | null }) {
      const prev = sharingMeta.get(deckId) ?? { visibility: "private", publicToken: null };
      sharingMeta.set(deckId, {
        visibility: meta.visibility ?? prev.visibility,
        publicToken: meta.publicToken === undefined ? prev.publicToken : meta.publicToken,
      });
    },
    get: (deckId: DeckId) => decks.get(deckId),
  };
}

export type SampleCard = {
  oracleId: string;
  name: string;
  printingId: string;
  /** For lines that name a printing: "(M11) 149". */
  setCode?: string;
  collectorNumber?: string;
  /** The finish this player's most special copy has (default nonfoil). */
  finish?: Finish;
  /** The finishes the printing comes in (default nonfoil and foil). */
  finishes?: Finish[];
};

/** Cards the catalog "has", found by exact name (front face of "A // B" too). */
export function inMemoryCardLookup(cards: readonly SampleCard[]): CardLookup {
  return {
    async exists(oracleId) {
      return cards.some((card) => card.oracleId === oracleId);
    },
    async printingFacts(printingId) {
      const card = cards.find((candidate) => candidate.printingId === printingId);
      if (card === undefined) return null;
      return { oracleId: card.oracleId, finishes: card.finishes ?? ["nonfoil", "foil"] };
    },
    async oracleIdsOf(printingIds) {
      const found = new Map<PrintingId, string>();
      for (const card of cards) {
        const printingId = PrintingId.of(card.printingId);
        if (printingIds.includes(printingId)) found.set(printingId, card.oracleId);
      }
      return found;
    },
    async existingOracleIds(oracleIds) {
      const known = new Set(cards.map((card) => card.oracleId));
      return new Set(oracleIds.filter((oracleId) => known.has(oracleId)));
    },
    async existingPrintings(printingIds) {
      const known = new Set(cards.map((card) => card.printingId));
      return new Set(printingIds.filter((printingId) => known.has(printingId)));
    },
    async resolve(_ownerId: UserId, queries: readonly CardQuery[]) {
      const found = new Map<number, ResolvedCard>();
      queries.forEach((query, index) => {
        const named = cards.filter(
          (candidate) =>
            candidate.name.toLowerCase() === query.name.toLowerCase() ||
            candidate.name.split(" // ")[0].toLowerCase() === query.name.toLowerCase(),
        );
        // The printing asked for if there is one, otherwise the first sample (the "special" one).
        const exact = named.find(
          (candidate) =>
            query.setCode !== null &&
            candidate.setCode === query.setCode &&
            (query.collectorNumber === null || candidate.collectorNumber === query.collectorNumber),
        );
        const card = exact ?? named[0];
        if (card !== undefined) {
          found.set(index, {
            oracleId: card.oracleId,
            printingId: PrintingId.of(card.printingId),
            finish: card.finish ?? "nonfoil",
            namedPrinting: exact !== undefined,
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
