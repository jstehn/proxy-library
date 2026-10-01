// The wiring shared by both composition roots (the Next.js app and the worker).
// This is the ONLY place that creates real implementations (database, clock, ...) and
// hands them to the functions that need them. Each phase adds its module's services here.
import { makeAccounts } from "@/modules/accounts";
import { drizzleEventRecorder } from "@/modules/activity/infrastructure";
import {
  betterAuthIdentityProvider,
  createAuth,
  cryptoSecretGenerator,
  drizzleInviteRepository,
  drizzlePlayerRepository,
} from "@/modules/accounts/infrastructure";
import { makeCatalog, PrintingId } from "@/modules/catalog";
import {
  diskArtworkStore,
  diskImageStore,
  drizzleArtworkRepository,
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
  httpImageFetcher,
  httpMtgjsonGateway,
  httpScryfallGateway,
  httpWpnGateway,
} from "@/modules/catalog/infrastructure";
import { drizzleCollectionRepository } from "@/modules/collection/infrastructure";
import { makeDecks, makeProxySheets } from "@/modules/decks";
import {
  drizzleCardLookup,
  drizzleDeckRepository,
  pdfLibRenderer,
} from "@/modules/decks/infrastructure";
import { makeInventory } from "@/modules/inventory";
import { drizzleItemRepository, drizzleProductCatalog } from "@/modules/inventory/infrastructure";
import { makePacks } from "@/modules/packs";
import { makeResetPlayer } from "@/modules/reset";
import { drizzleBoosterSource } from "@/modules/packs/infrastructure";
import { makeStore } from "@/modules/store";
import {
  drizzleMarketPrices,
  drizzlePriceList,
  drizzleStoreLedger,
  drizzleStoreSettings,
} from "@/modules/store/infrastructure";
import { makeTrades } from "@/modules/trades";
import {
  drizzleHoldings,
  drizzleTradePlayers,
  drizzleTradeRepository,
} from "@/modules/trades/infrastructure";
import { makeWallet } from "@/modules/wallet";
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
import { makeCheckHealth } from "./health";

export function buildCore(config: Config) {
  const { db, close } = createDatabase(config.databaseUrl);
  const clock = systemClock();
  const auth = createAuth({ db, secret: config.authSecret, appUrl: config.appUrl });

  // Called at the start of every transaction: builds each module's services so that all
  // of their database work happens inside that one transaction (ADR 0005).
  function servicesFor(transaction: DbExecutor) {
    return {
      system: makeSystemService(transaction),
      players: drizzlePlayerRepository(transaction),
      invites: drizzleInviteRepository(transaction),
      wallets: drizzleWalletRepository(transaction),
      economy: drizzleEconomySettingsRepository(transaction),
      playerDirectory: drizzlePlayerDirectory(transaction),
      catalog: drizzleCatalogRepository(transaction),
      syncRuns: drizzleSyncRunRepository(transaction),
      artwork: drizzleArtworkRepository(transaction),
      boosters: drizzleBoosterSource(transaction),
      collection: drizzleCollectionRepository(transaction),
      items: drizzleItemRepository(transaction),
      productCatalog: drizzleProductCatalog(transaction),
      priceList: drizzlePriceList(transaction),
      storeLedger: drizzleStoreLedger(transaction),
      marketPrices: drizzleMarketPrices(transaction),
      storeSettings: drizzleStoreSettings(transaction),
      decks: drizzleDeckRepository(transaction),
      cards: drizzleCardLookup(transaction),
      trades: drizzleTradeRepository(transaction),
      tradePlayers: drizzleTradePlayers(transaction),
      holdings: drizzleHoldings(transaction),
      events: drizzleEventRecorder(transaction),
    };
  }

  const unitOfWork = makeDrizzleUnitOfWork(db, servicesFor);

  const accounts = makeAccounts({
    unitOfWork,
    identity: betterAuthIdentityProvider(auth),
    secrets: cryptoSecretGenerator(),
    clock,
  });

  const wallet = makeWallet({ unitOfWork, clock });

  // A polite fetch for outside services (design doc 04, rule 10): identifies us, spaces
  // requests out, and retries temporary failures. Each service gets its own speed limit.
  const userAgent = `ProxyLibrary/1.0 (self-hosted playgroup app; ${config.appUrl})`;
  function politeFetch(perSecond: number): Fetch {
    const withRetries = withRetry({ attempts: 3, sleep: realSleep })(platformFetch);
    const limited = withRateLimit({ perSecond, clock, sleep: realSleep })(withRetries);
    return withUserAgent(userAgent)(limited);
  }

  const catalog = makeCatalog({
    unitOfWork,
    mtgjson: httpMtgjsonGateway(politeFetch(4)),
    scryfall: httpScryfallGateway(politeFetch(8), config.syncCacheDir),
    images: diskImageStore(config.imageCacheDir),
    imageFetcher: httpImageFetcher(politeFetch(10)),
    // WPN pages one a second; their images come from a CDN (design doc 13, rule 3).
    wpn: httpWpnGateway(politeFetch(1), politeFetch(4)),
    artworkFiles: diskArtworkStore(config.imageCacheDir),
    clock,
    syncTime: config.syncTime,
  });

  const seeds = { newSeed: randomSeed };
  const packs = makePacks({ unitOfWork, seeds });
  const inventory = makeInventory({ unitOfWork, clock, seeds });
  const store = makeStore({ unitOfWork, clock });
  const decks = makeDecks({ unitOfWork, clock });
  // Proxy PDFs use the large card images, from the catalog's cache (design doc 14, section 3).
  const proxySheet = makeProxySheets({
    images: {
      async image(printingId, face) {
        const found = await catalog.imageFor({
          printingId: PrintingId.of(printingId),
          size: "large",
          face,
        });
        return found.ok ? found.value : null;
      },
    },
    renderer: pdfLibRenderer(),
  });
  const trades = makeTrades({ unitOfWork, clock });
  const resetPlayer = makeResetPlayer({ unitOfWork, clock });

  return {
    config,
    db,
    clock,
    unitOfWork,
    accounts,
    wallet,
    catalog,
    packs,
    inventory,
    store,
    decks,
    proxySheet,
    trades,
    resetPlayer,
    checkHealth: makeCheckHealth({ unitOfWork, clock }),
    close,
  };
}

export type Core = ReturnType<typeof buildCore>;
