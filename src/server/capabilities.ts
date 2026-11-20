import { wireCollectionCapabilities } from "@/modules/collection/wiring";
import { wireDraftCapabilities } from "@/modules/drafts/wiring";
import { wireRealCollectionCapabilities } from "@/modules/real-collection/wiring";
import { wireStoreCapabilities } from "@/modules/store/wiring";
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
import {
  decksUsing,
  findCard,
  type DeckSharing,
  type makeProxySheets,
  type makeTokenChoices,
  type Decks,
  type PreviewRepository,
} from "@/modules/decks";
import { wireDeckCapabilities } from "@/modules/decks/wiring";
import { wishesAtTarget, wishesForCard, type Wishlist } from "@/modules/wishlist";
import { wireWishlistCapabilities } from "@/modules/wishlist/wiring";
import type { Actor, makeAccounts } from "@/modules/accounts";
import type { makeCatalog } from "@/modules/catalog";
import { activeDraftOf, type makeDrafts } from "@/modules/drafts";
import type { makePacks } from "@/modules/packs";
import type { makeResetPlayer } from "@/modules/reset";
import { socialQueries, type makeSocial } from "@/modules/social";
import { tradeQueries, type makeTrades } from "@/modules/trades";
import type { makeWallet } from "@/modules/wallet";
import type { makeWishlist } from "@/modules/wishlist";
import type { makeInventory } from "@/modules/inventory";
import type { makeRealCollection } from "@/modules/real-collection";
import type { makeStore } from "@/modules/store";
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
  /** The services that change things: the capabilities pass them through for the adapters. */
  services: Readonly<{
    deckSharing: DeckSharing;
    chooseToken: ReturnType<typeof makeTokenChoices>;
    proxySheet: ReturnType<typeof makeProxySheets>;
    seeds: Readonly<{ newSeed(): string }>;
    drafts: ReturnType<typeof makeDrafts>;
    realCollection: ReturnType<typeof makeRealCollection>;
    store: ReturnType<typeof makeStore>;
    inventory: ReturnType<typeof makeInventory>;
    accounts: ReturnType<typeof makeAccounts>;
    wallet: ReturnType<typeof makeWallet>;
    social: ReturnType<typeof makeSocial>;
    trades: ReturnType<typeof makeTrades>;
    wishlist: ReturnType<typeof makeWishlist>;
    catalog: ReturnType<typeof makeCatalog>;
    packs: ReturnType<typeof makePacks>;
    resetPlayer: ReturnType<typeof makeResetPlayer>;
    appUrl: string;
  }>;
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
    ...wireCollectionCapabilities({ db }),
    ...wireRealCollectionCapabilities({ db }),
    ...wireDraftCapabilities({ db }),
    ...wireStoreCapabilities({ db }),
    ...wireWishlistCapabilities({
      db,
      clock,
      wallet,
      wishlist,
      findCard: (nameOrId) => findCard(db, nameOrId),
    }),
    ...wireAccountCapabilities({ db, clock, wallet }),
    ...dependencies.services,
    // The numbers in the site header, in one round trip. Showing the balance also pays any
    // allowance that has come due (design doc 03, section 5).
    headerSummary: async (actor: Actor) => {
      const userId = actor.userId;
      const [balance, waitingTrades, wishesOnTarget, draft, friendRequests] = await Promise.all([
        dependencies.services.wallet.refreshWallet(userId),
        tradeQueries.waitingForYou(db, actor),
        wishesAtTarget(db, userId),
        activeDraftOf(db, userId),
        socialQueries.incomingRequestCount(db, actor),
      ]);
      return { balance, waitingTrades, wishesOnTarget, draft, friendRequests };
    },
    now: () => clock.now(),
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
