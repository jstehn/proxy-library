import { wireAccountCapabilities } from "@/modules/accounts/wiring";
import { wireCatalogCapabilities } from "@/modules/catalog/wiring";
import {
  makeCardLookup,
  makeSearchCatalog,
  makeRulesLookup,
  lookupRules,
  searchPrintings,
  priceHistory,
  printingCards,
  printingDetail,
  storePrintingsOfCard,
} from "@/modules/catalog";
import {
  collectionPage,
  ownedByOracle,
  ownedCopies as ownedOfPrinting,
} from "@/modules/collection";
import { realCollectionPage, realOwnedByOracle } from "@/modules/real-collection";
import { decksUsing, findCard, type Decks, type PreviewRepository } from "@/modules/decks";
import { wireDeckCapabilities } from "@/modules/decks/wiring";
import { wishesForCard, type Wishlist } from "@/modules/wishlist";
import { wireWishlistCapabilities } from "@/modules/wishlist/wiring";
import type { OutsideDataService } from "@/modules/catalog/infrastructure";
import type { makeReddit } from "@/modules/reddit";
import type { makeYoutube } from "@/modules/youtube";
import type { DbExecutor } from "@/shared/db";
import type { Cents, Clock, UserId } from "@/shared/kernel";

// The capabilities (ADR 0026): typed functions that the adapters (server actions, LLM tool
// bindings, routes, worker commands) call. Each module builds its own in its `wiring.ts`; this
// file joins them and adds the few that read across modules.

type CapabilityDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  wallet: Readonly<{ refreshWallet(userId: UserId): Promise<Cents> }>;
  textEmbedder: (texts: readonly string[]) => Promise<number[][]>;
  wishlist: Pick<Wishlist, "addWish" | "removeWish">;
  outsideData: OutsideDataService;
  youtube: ReturnType<typeof makeYoutube>;
  reddit: ReturnType<typeof makeReddit>;
  decks: Decks;
  previews: PreviewRepository;
  newPreviewId: () => string;
}>;

export function buildCapabilities(dependencies: CapabilityDependencies) {
  const { db, clock, wallet, wishlist, textEmbedder, outsideData } = dependencies;

  return {
    ...wireDeckCapabilities({
      db,
      clock,
      textEmbedder,
      outsideData: {
        fetchEdhrecCommander: (commander, options) =>
          outsideData.fetchEdhrecCommander(commander, options),
        fetchSpellbookCombos: (mainCards, commanders) =>
          outsideData.fetchSpellbookCombos(mainCards, commanders),
      },
      decks: dependencies.decks,
      previews: dependencies.previews,
      newPreviewId: dependencies.newPreviewId,
    }),
    ...wireCatalogCapabilities({ db }),
    ...wireWishlistCapabilities({
      db,
      clock,
      wallet,
      wishlist,
      findCard: (nameOrId) => findCard(db, nameOrId),
    }),
    ...wireAccountCapabilities({ db, clock, wallet }),
    youtube: dependencies.youtube,
    reddit: dependencies.reddit,
    // These read across modules (the game's collection, the real one, the store, the decks and
    // the wishlist), so they are joined here rather than in one module's wiring.
    rulesLookup: makeRulesLookup({
      findCard: (query) => findCard(db, query),
      fetchRulings: (target) => outsideData.fetchScryfallRulings(target),
      searchRules: (query, limit) => lookupRules(db, textEmbedder, { query, limit }),
    }),
    lookUpCards: makeCardLookup({
      find: (query) => findCard(db, query),
      detail: (printingId) => printingDetail(db, printingId),
      history: (printingId) => priceHistory(db, printingId),
      ownedOfPrinting: (userId, printingId) => ownedOfPrinting(db, userId, printingId),
      gameCopies: (userId, oracleId) => ownedByOracle(db, userId, oracleId),
      realCopies: (userId, oracleId) => realOwnedByOracle(db, userId, oracleId),
      decksUsing: async (userId, printingId) =>
        (await decksUsing(db, userId, [printingId])).get(printingId) ?? [],
      wishes: (userId, printingId) => wishesForCard(db, userId, printingId),
      storePrintings: (userId, name) => storePrintingsOfCard(db, userId, name, 20),
    }),
    searchCatalog: makeSearchCatalog({
      collection: (userId, page, search) =>
        collectionPage(db, userId, { search, sections: "none", sort: "name", page }),
      realCollection: (userId, page, search) =>
        realCollectionPage(db, userId, { search, sections: "none", sort: "name", page }),
      store: (userId, search, page, oneRowPerCard) =>
        searchPrintings(db, { userId, search, sort: "name", page, oneRowPerCard }),
      printings: (ids) => printingCards(db, ids),
    }),
  };
}

export type Capabilities = ReturnType<typeof buildCapabilities>;
