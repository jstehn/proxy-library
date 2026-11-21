import {
  lookupRules,
  makeCardLookup,
  makeRulesLookup,
  makeSearchCatalog,
  printingCards,
  storePrintingsOfCard,
} from "@/modules/catalog";
import type { OutsideDataService } from "@/modules/catalog/infrastructure";
import { decksUsing, findCard } from "@/modules/decks";
import type { DbExecutor } from "@/shared/db";
import type { Reads } from "./reads";

// The capabilities that read across modules (the game's collection, the real one, the store, the
// decks and the wishlist), so they are joined here rather than in one module's wiring. Each takes
// the readers it needs from `reads`.

export type LookupWiringDependencies = Readonly<{
  db: DbExecutor;
  reads: Reads;
  textEmbedder: (texts: readonly string[]) => Promise<number[][]>;
  outsideData: OutsideDataService;
}>;

export function wireLookupCapabilities(dependencies: LookupWiringDependencies) {
  const { db, reads, textEmbedder, outsideData } = dependencies;
  return {
    rulesLookup: makeRulesLookup({
      findCard: (query) => findCard(db, query),
      fetchRulings: (target) => outsideData.fetchScryfallRulings(target),
      searchRules: (query, limit) => lookupRules(db, textEmbedder, { query, limit }),
    }),
    lookUpCards: makeCardLookup({
      find: (query) => findCard(db, query),
      detail: (printingId) => reads.catalog.printingDetail(printingId),
      history: (printingId) => reads.catalog.priceHistory(printingId),
      ownedOfPrinting: (actor, printingId) => reads.collection.ownedCopies(actor, printingId),
      gameCopies: (actor, oracleId) => reads.collection.ownedByOracle(actor, oracleId),
      realCopies: (actor, oracleId) => reads.realCollection.ownedByOracle(actor, oracleId),
      decksUsing: async (actor, printingId) =>
        (await decksUsing(db, actor.userId, [printingId])).get(printingId) ?? [],
      wishes: (actor, printingId) => reads.wishlist.forCard(actor, printingId),
      storePrintings: (actor, name) => storePrintingsOfCard(db, actor, name, 20),
    }),
    searchCatalog: makeSearchCatalog({
      collection: (actor, page, search) =>
        reads.collection.page(actor, { search, sections: "none", sort: "name", page }),
      realCollection: (actor, page, search) =>
        reads.realCollection.page(actor, actor.userId, {
          search,
          sections: "none",
          sort: "name",
          page,
        }),
      store: (actor, search, page, oneRowPerCard) =>
        reads.catalog.searchPrintings(actor, { search, sort: "name", page, oneRowPerCard }),
      printings: (ids) => printingCards(db, ids),
    }),
  };
}
