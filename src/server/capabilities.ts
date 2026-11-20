import { wireAccountCapabilities } from "@/modules/accounts/wiring";
import { wireInventoryCapabilities } from "@/modules/inventory/wiring";
import { wirePackCapabilities } from "@/modules/packs/wiring";
import {
  makeCardLookup,
  makeSearchCatalog,
  makeRulesLookup,
  lookupRules,
  catalogQueries,
  printingCards,
  storePrintingsOfCard,
} from "@/modules/catalog";
import { collectionQueries } from "@/modules/collection";
import { realCollectionQueries } from "@/modules/real-collection";
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
import { wishlistQueries, type Wishlist } from "@/modules/wishlist";
import { wireWishlistCapabilities } from "@/modules/wishlist/wiring";
import type { Inventory } from "@/modules/inventory";
import type { Packs } from "@/modules/packs";
import type { Actor, makeAccounts } from "@/modules/accounts";
import type { makeCatalog } from "@/modules/catalog";
import { draftQueries, type Drafts } from "@/modules/drafts";
import { wireDraftCapabilities } from "@/modules/drafts/wiring";
import type { makeResetPlayer } from "@/modules/reset";
import { socialQueries, type Social } from "@/modules/social";
import { wireSocialCapabilities } from "@/modules/social/wiring";
import { tradeQueries, type Trades } from "@/modules/trades";
import { wireTradeCapabilities } from "@/modules/trades/wiring";
import type { Wallet } from "@/modules/wallet";
import { wireWalletCapabilities } from "@/modules/wallet/wiring";
import type { RealCollection } from "@/modules/real-collection";
import { wireRealCollectionCapabilities } from "@/modules/real-collection/wiring";
import type { Store } from "@/modules/store";
import { wireStoreCapabilities } from "@/modules/store/wiring";
import type { OutsideDataService } from "@/modules/catalog/infrastructure";
import type { makeReddit } from "@/modules/reddit";
import type { makeYoutube } from "@/modules/youtube";
import type { DbExecutor } from "@/shared/db";
import type { Clock } from "@/shared/kernel";

// The capabilities (ADR 0026): typed functions that the adapters (server actions, LLM tool
// bindings, routes, worker commands) call. Each module builds its own in its `wiring.ts`; this
// file joins them and adds the few that read across modules.

type CapabilityDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  wallet: Wallet;
  social: Social;
  trades: Trades;
  drafts: Drafts;
  store: Store;
  realCollection: RealCollection;
  textEmbedder: (texts: readonly string[]) => Promise<number[][]>;
  wishlist: Wishlist;
  outsideData: OutsideDataService;
  youtube: ReturnType<typeof makeYoutube>;
  reddit: ReturnType<typeof makeReddit>;
  decks: Decks;
  previews: PreviewRepository;
  packs: Packs;
  inventory: Inventory;
  /** The services that change things: the capabilities pass them through for the adapters. */
  services: Readonly<{
    deckSharing: DeckSharing;
    chooseToken: ReturnType<typeof makeTokenChoices>;
    proxySheet: ReturnType<typeof makeProxySheets>;
    seeds: Readonly<{ newSeed(): string }>;
    accounts: ReturnType<typeof makeAccounts>;
    catalog: ReturnType<typeof makeCatalog>;
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
    ...wireWishlistCapabilities({
      db,
      clock,
      wallet,
      wishlist,
      findCard: (nameOrId) => findCard(db, nameOrId),
    }),
    ...wireAccountCapabilities({ db, clock, wallet }),
    ...wirePackCapabilities(dependencies),
    ...wireInventoryCapabilities(dependencies),
    ...wireWalletCapabilities(dependencies),
    ...wireSocialCapabilities(dependencies),
    ...wireTradeCapabilities(dependencies),
    ...wireDraftCapabilities(dependencies),
    ...wireStoreCapabilities(dependencies),
    ...wireRealCollectionCapabilities(dependencies),
    ...dependencies.services,
    // The numbers in the site header, in one round trip. Showing the balance also pays any
    // allowance that has come due (design doc 03, section 5).
    headerSummary: async (actor: Actor) => {
      const [balance, waitingTrades, wishesOnTarget, draft, friendRequests] = await Promise.all([
        wallet.refreshWallet(actor),
        tradeQueries.waitingForYou(db, actor),
        wishlistQueries.atTarget(db, actor),
        draftQueries.activeDraftOf(db, actor),
        socialQueries.incomingRequestCount(db, actor),
      ]);
      return { balance, waitingTrades, wishesOnTarget, draft, friendRequests };
    },
    now: () => clock.now(),
    /** Card details for printings, for the selected-card panel and previews. */
    printingDetails: (printingIds: readonly string[]) => printingCards(db, printingIds),
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
      detail: (printingId) => catalogQueries.printingDetail(db, printingId),
      history: (printingId) => catalogQueries.priceHistory(db, printingId),
      ownedOfPrinting: (actor, printingId) => collectionQueries.ownedCopies(db, actor, printingId),
      gameCopies: (actor, oracleId) => collectionQueries.ownedByOracle(db, actor, oracleId),
      realCopies: (actor, oracleId) => realCollectionQueries.ownedByOracle(db, actor, oracleId),
      decksUsing: async (actor, printingId) =>
        (await decksUsing(db, actor.userId, [printingId])).get(printingId) ?? [],
      wishes: (actor, printingId) => wishlistQueries.forCard(db, actor, printingId),
      storePrintings: (actor, name) => storePrintingsOfCard(db, actor, name, 20),
    }),
    searchCatalog: makeSearchCatalog({
      collection: (actor, page, search) =>
        collectionQueries.page(db, actor, { search, sections: "none", sort: "name", page }),
      realCollection: (actor, page, search) =>
        realCollectionQueries.page(db, actor, actor.userId, {
          search,
          sections: "none",
          sort: "name",
          page,
        }),
      store: (actor, search, page, oneRowPerCard) =>
        catalogQueries.searchPrintings(db, actor, { search, sort: "name", page, oneRowPerCard }),
      printings: (ids) => printingCards(db, ids),
    }),
  };
}

export type Capabilities = ReturnType<typeof buildCapabilities>;
