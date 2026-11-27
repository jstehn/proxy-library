// The wiring shared by both composition roots (the Next.js app and the worker).
// This is the ONLY place that creates real implementations (database, clock, ...) and
// hands them to the functions that need them. Each phase adds its module's services here.
import { randomBytes, randomUUID } from "node:crypto";
import { buildCapabilities } from "./capabilities";
import { buildPublicReads, buildReads } from "./reads";
import { makeAccounts } from "@/modules/accounts";
import { drizzleEventRecorder } from "@/modules/activity/infrastructure";
import {
  betterAuthIdentityProvider,
  createAuth,
  cryptoSecretGenerator,
  drizzleAccessTokenRepository,
  drizzleInviteRepository,
  drizzleOAuthRepository,
  drizzlePlayerRepository,
} from "@/modules/accounts/infrastructure";
import { makeCatalog, PrintingId } from "@/modules/catalog";
import {
  diskArtworkStore,
  diskImageStore,
  drizzleArtworkRepository,
  drizzleCatalogRepository,
  drizzleComprehensiveRulesRepository,
  drizzleEdhrecRepository,
  drizzleCardFeatureStore,
  drizzleEmbeddingRepository,
  drizzleSpellbookRepository,
  drizzleSyncRunRepository,
  httpComprehensiveRulesGateway,
  httpEdhrecGateway,
  httpImageFetcher,
  diskContentsOverrides,
  httpMtgjsonGateway,
  httpScryfallGateway,
  httpSpellbookGateway,
  httpWpnGateway,
  huggingFaceTextEmbedder,
  makeOutsideData,
} from "@/modules/catalog/infrastructure";
import { drizzleCollectionRepository } from "@/modules/collection/infrastructure";
import {
  makeDecks,
  makeDeckSharing,
  makeDeckSnapshots,
  makeProxySheets,
  makeTokenChoices,
} from "@/modules/decks";
import {
  drizzleCardLookup,
  drizzleDeckRepository,
  drizzleDeckSharing,
  drizzleSnapshotRepository,
  drizzleDeckTokenRepository,
  drizzleChangePreviewRepository,
  pdfLibRenderer,
} from "@/modules/decks/infrastructure";
import { makeDrafts } from "@/modules/drafts";
import {
  drizzleDraftCatalog,
  drizzleDraftRepository,
  pgDraftNotifier,
} from "@/modules/drafts/infrastructure";
import { makeInventory } from "@/modules/inventory";
import { drizzleItemRepository, drizzleProductCatalog } from "@/modules/inventory/infrastructure";
import { makePacks } from "@/modules/packs";
import { makeRealCollection, realPrintingIds } from "@/modules/collection/real";
import {
  drizzleRealCollectionRepository,
  sqlPrintingMatcher,
} from "@/modules/collection/infrastructure";
import { makeResetPlayer } from "@/modules/reset";
import { drizzleBoosterSource } from "@/modules/packs/infrastructure";
import { makeStore } from "@/modules/store";
import {
  drizzleMarketPrices,
  drizzlePriceList,
  drizzleStoreLedger,
  drizzleProductValues,
  drizzleStoreSettings,
} from "@/modules/store/infrastructure";
import { makeTrades } from "@/modules/trades";
import {
  drizzleHoldings,
  drizzleTradePlayers,
  drizzleTradeRepository,
} from "@/modules/trades/infrastructure";
import { makeSocial } from "@/modules/social";
import {
  drizzleFriendshipRepository,
  drizzleProfileRepository,
  drizzleShowcaseValidator,
  drizzleSocialPlayerLookup,
} from "@/modules/social/infrastructure";
import { makeWallet } from "@/modules/wallet";
import { makeWishlist } from "@/modules/wishlist";
import { drizzleWishCatalog, drizzleWishRepository } from "@/modules/wishlist/infrastructure";
import { makeReddit } from "@/modules/research";
import { redditHttpGateway } from "@/modules/research/infrastructure";
import { makeYoutube } from "@/modules/research";
import { youtubeiGateway } from "@/modules/research/infrastructure";
import {
  drizzleEconomySettingsRepository,
  drizzlePlayerDirectory,
  drizzleWalletRepository,
} from "@/modules/wallet/infrastructure";
import type { Config } from "@/shared/config";
import {
  createDatabase,
  makeDrizzleUnitOfWork,
  makeSystemService,
  type DbExecutor,
} from "@/shared/db";
import { platformFetch, withRateLimit, withRetry, withUserAgent, type Fetch } from "@/shared/http";
import { randomSeed, realSleep, systemClock } from "@/shared/runtime";
import { recordHttpEvent, recordQueryEvent, setMetricsLogging } from "../observability";
import { makeCheckHealth } from "./health";

export function buildCore(config: Config) {
  setMetricsLogging(config.nodeEnv !== "test");
  const { db, close } = createDatabase(config.databaseUrl, { onQuery: recordQueryEvent });
  const clock = systemClock();
  const auth = createAuth({
    db,
    secret: config.authSecret,
    appUrl: config.appUrl,
    oidc: config.oidc,
  });

  // Called at the start of every transaction: builds each module's services so that all
  // of their database work happens inside that one transaction (ADR 0005).
  function servicesFor(transaction: DbExecutor) {
    return {
      system: makeSystemService(transaction),
      players: drizzlePlayerRepository(transaction),
      invites: drizzleInviteRepository(transaction),
      accessTokens: drizzleAccessTokenRepository(transaction),
      oauth: drizzleOAuthRepository(transaction),
      wallets: drizzleWalletRepository(transaction),
      economy: drizzleEconomySettingsRepository(transaction),
      playerDirectory: drizzlePlayerDirectory(transaction),
      catalog: drizzleCatalogRepository(transaction),
      syncRuns: drizzleSyncRunRepository(transaction),
      artwork: drizzleArtworkRepository(transaction),
      edhrec: drizzleEdhrecRepository(transaction),
      spellbook: drizzleSpellbookRepository(transaction),
      embeddings: drizzleEmbeddingRepository(transaction),
      cardFeatures: drizzleCardFeatureStore(transaction),
      comprehensiveRules: drizzleComprehensiveRulesRepository(transaction),
      boosters: drizzleBoosterSource(transaction),
      collection: drizzleCollectionRepository(transaction),
      items: drizzleItemRepository(transaction),
      productCatalog: drizzleProductCatalog(transaction),
      priceList: drizzlePriceList(transaction),
      storeLedger: drizzleStoreLedger(transaction),
      marketPrices: drizzleMarketPrices(transaction),
      storeSettings: drizzleStoreSettings(transaction),
      productValues: drizzleProductValues(transaction),
      decks: drizzleDeckRepository(transaction),
      cards: drizzleCardLookup(transaction),
      deckTokens: drizzleDeckTokenRepository(transaction),
      deckSharing: drizzleDeckSharing(transaction),
      snapshots: drizzleSnapshotRepository(transaction),
      trades: drizzleTradeRepository(transaction),
      tradePlayers: drizzleTradePlayers(transaction),
      holdings: drizzleHoldings(transaction),
      events: drizzleEventRecorder(transaction),
      drafts: drizzleDraftRepository(transaction),
      draftCatalog: drizzleDraftCatalog(transaction),
      draftNotifier: pgDraftNotifier(transaction),
      realCollection: drizzleRealCollectionRepository(transaction),
      printingMatcher: sqlPrintingMatcher(transaction),
      // A real product's contents are read exactly as inventory reads a game product's.
      productContents: drizzleProductCatalog(transaction),
      wishes: drizzleWishRepository(transaction),
      wishCatalog: drizzleWishCatalog(transaction),
      profiles: drizzleProfileRepository(transaction),
      friendships: drizzleFriendshipRepository(transaction),
      socialPlayers: drizzleSocialPlayerLookup(transaction),
      showcaseValidator: drizzleShowcaseValidator(transaction),
    };
  }

  const unitOfWork = makeDrizzleUnitOfWork(db, servicesFor);

  const accounts = makeAccounts({
    unitOfWork,
    identity: betterAuthIdentityProvider(auth),
    secrets: cryptoSecretGenerator(),
    clock,
    readPlayers: drizzlePlayerRepository(db),
    readAccessTokens: drizzleAccessTokenRepository(db),
  });

  const wallet = makeWallet({ unitOfWork, clock });

  // A polite fetch for outside services (design doc 04, rule 10): identifies us, spaces
  // requests out, and retries temporary failures. Each service gets its own speed limit.
  const timedFetch: Fetch = async (url, init) => {
    const startMs = performance.now();
    let status: number | null = null;
    try {
      const response = await platformFetch(url, init);
      status = response.status;
      return response;
    } finally {
      let host = "unknown";
      try {
        host = new URL(url).host || "unknown";
      } catch {
        // Leave host as "unknown" when URL parsing fails.
      }
      recordHttpEvent({ host, durationMs: performance.now() - startMs, status });
    }
  };
  const userAgent = `ProxyLibrary/1.0 (self-hosted playgroup app; ${config.appUrl})`;
  function politeFetch(perSecond: number): Fetch {
    const withRetries = withRetry({ attempts: 3, sleep: realSleep })(timedFetch);
    const limited = withRateLimit({ perSecond, clock, sleep: realSleep })(withRetries);
    return withUserAgent(userAgent)(limited);
  }

  const textEmbedder = huggingFaceTextEmbedder();
  const catalogReads = drizzleCatalogRepository(db);

  const catalog = makeCatalog({
    unitOfWork,
    // Printings owned for real get nightly prices too (design doc 16, section 7).
    extraPricedPrintings: {
      printingIds: async () => (await realPrintingIds(db)).map(PrintingId.of),
    },
    mtgjson: httpMtgjsonGateway(politeFetch(4)),
    contentsOverrides: diskContentsOverrides(config.sealedContentsDir),
    scryfall: httpScryfallGateway(politeFetch(8), config.syncCacheDir),
    images: diskImageStore(config.imageCacheDir),
    imageFetcher: httpImageFetcher(politeFetch(10)),
    // WPN pages one a second; their images come from a CDN (design doc 13, rule 3).
    wpn: httpWpnGateway(politeFetch(1), politeFetch(4)),
    artworkFiles: diskArtworkStore(config.imageCacheDir),
    readImageSource: (printingId) => catalogReads.imageSource(printingId),
    // EDHREC pages one a second (design doc 45, invariant 5).
    edhrec: httpEdhrecGateway(politeFetch(1)),
    spellbook: httpSpellbookGateway(politeFetch(1)),
    comprehensiveRules: httpComprehensiveRulesGateway(politeFetch(1)),
    textEmbedder,
    clock,
    syncTime: config.syncTime,
  });

  const seeds = { newSeed: randomSeed };
  const packs = makePacks({ unitOfWork, seeds });
  const inventory = makeInventory({ unitOfWork, clock, seeds });
  const store = makeStore({ unitOfWork, clock });
  const decks = makeDecks({ unitOfWork, clock });
  const deckSnapshots = makeDeckSnapshots({ unitOfWork, clock });
  const deckSharing = makeDeckSharing({
    unitOfWork,
    clock,
    tokens: { newPublicToken: () => randomBytes(16).toString("base64url") },
  });
  // Token art and "print it" choices for a deck's proxies (design doc 25).
  const chooseToken = makeTokenChoices({ unitOfWork });
  // Proxy PDFs use the large card images, from the catalog's cache (design doc 14, section 3);
  // playtest proxies use the art crops (design doc 22).
  async function cachedImage(
    printingId: string,
    face: "front" | "back",
    size: "large" | "artCrop",
  ) {
    const found = await catalog.imageFor({ printingId: PrintingId.of(printingId), size, face });
    return found.ok ? found.value : null;
  }
  const proxySheet = makeProxySheets({
    images: {
      image: (printingId, face) => cachedImage(printingId, face, "large"),
      artCrop: (printingId, face) => cachedImage(printingId, face, "artCrop"),
    },
    renderer: pdfLibRenderer(),
  });
  const trades = makeTrades({ unitOfWork, clock });
  const drafts = makeDrafts({ unitOfWork, clock, seeds });
  const resetPlayer = makeResetPlayer({ unitOfWork, clock });
  const realCollection = makeRealCollection({ unitOfWork, clock });
  const wishlist = makeWishlist({ unitOfWork, clock });
  const social = makeSocial({ unitOfWork, clock });
  const outsideData = makeOutsideData(clock, timedFetch);
  const youtube = makeYoutube({ gateway: youtubeiGateway(clock) });
  const reddit = makeReddit({
    gateway: redditHttpGateway(clock, {
      fetchFn: timedFetch,
      clientId: config.redditClientId,
      clientSecret: config.redditClientSecret,
      braveSearchApiKey: config.braveSearchApiKey,
      searxngUrl: config.searxngUrl,
    }),
  });

  const reads = buildReads(db);
  const checkHealth = makeCheckHealth({ unitOfWork, clock });

  return {
    config,
    db,
    clock,
    /** Fresh seeds, e.g. for the deck builder's test hands (design doc 19). */
    seeds,
    unitOfWork,
    accounts,
    wallet,
    catalog,
    packs,
    inventory,
    store,
    decks,
    deckSharing,
    deckSnapshots,
    chooseToken,
    proxySheet,
    trades,
    drafts,
    resetPlayer,
    realCollection,
    wishlist,
    social,
    outsideData,
    youtube,
    reddit,
    textEmbedder,
    reads,
    publicReads: buildPublicReads(db),
    capabilities: buildCapabilities({
      db,
      clock,
      reads,
      textEmbedder,
      outsideData,
      seeds,
      appUrl: config.appUrl,
      checkHealth,
      newPreviewId: randomUUID,
      previews: drizzleChangePreviewRepository(db),
      accounts,
      catalog,
      decks,
      deckSharing,
      deckSnapshots,
      chooseToken,
      proxySheet,
      drafts,
      inventory,
      packs,
      realCollection,
      reddit,
      resetPlayer,
      social,
      store,
      trades,
      wallet,
      wishlist,
      youtube,
    }),
    checkHealth,
    close,
  };
}

export type Core = ReturnType<typeof buildCore>;
