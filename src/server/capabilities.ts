import type { Accounts } from "@/modules/accounts";
import { wireAccountCapabilities } from "@/modules/accounts/wiring";
import type { Catalog } from "@/modules/catalog";
import type { OutsideDataService } from "@/modules/catalog/infrastructure";
import { wireCatalogCapabilities } from "@/modules/catalog/wiring";
import {
  findCard,
  type Decks,
  type DeckSharing,
  type DeckSnapshots,
  type makeProxySheets,
  type makeTokenChoices,
  type PreviewRepository,
} from "@/modules/decks";
import { wireDeckCapabilities } from "@/modules/decks/wiring";
import type { Drafts } from "@/modules/drafts";
import { wireDraftCapabilities } from "@/modules/drafts/wiring";
import type { Inventory } from "@/modules/inventory";
import { wireInventoryCapabilities } from "@/modules/inventory/wiring";
import type { Packs } from "@/modules/packs";
import { wirePackCapabilities } from "@/modules/packs/wiring";
import type { RealCollection } from "@/modules/collection/real";
import { wireRealCollectionCapabilities } from "@/modules/collection/wiring";
import type { RedditService } from "@/modules/research";
import { wireRedditCapabilities } from "@/modules/research/wiring";
import type { makeResetPlayer } from "@/modules/reset";
import { wireResetCapabilities } from "@/modules/reset/wiring";
import type { Social } from "@/modules/social";
import { wireSocialCapabilities } from "@/modules/social/wiring";
import type { Store } from "@/modules/store";
import { wireStoreCapabilities } from "@/modules/store/wiring";
import type { Trades } from "@/modules/trades";
import { wireTradeCapabilities } from "@/modules/trades/wiring";
import type { Wallet } from "@/modules/wallet";
import { wireWalletCapabilities } from "@/modules/wallet/wiring";
import type { Wishlist } from "@/modules/wishlist";
import { wireWishlistCapabilities } from "@/modules/wishlist/wiring";
import type { YoutubeService } from "@/modules/research";
import { wireYoutubeCapabilities } from "@/modules/research/wiring";
import type { DbExecutor } from "@/shared/db";
import type { Clock } from "@/shared/kernel";
import { accountOverviewReaders } from "./account-overview";
import { wireLookupCapabilities } from "./lookups";
import type { Reads } from "./reads";
import { wireSiteCapabilities } from "./site";

// The capabilities (ADR 0026): typed functions that the adapters (server actions, LLM tool
// bindings, routes, worker commands) call. Each module builds its own in its `wiring.ts`; this
// file hands each one what it needs and joins the results.

type CapabilityDependencies = Readonly<{
  db: DbExecutor;
  clock: Clock;
  reads: Reads;
  textEmbedder: (texts: readonly string[]) => Promise<number[][]>;
  outsideData: OutsideDataService;
  seeds: Readonly<{ newSeed(): string }>;
  appUrl: string;
  newPreviewId: () => string;
  previews: PreviewRepository;
  accounts: Accounts;
  catalog: Catalog;
  decks: Decks;
  deckSharing: DeckSharing;
  deckSnapshots: DeckSnapshots;
  chooseToken: ReturnType<typeof makeTokenChoices>;
  proxySheet: ReturnType<typeof makeProxySheets>;
  drafts: Drafts;
  inventory: Inventory;
  packs: Packs;
  realCollection: RealCollection;
  reddit: RedditService;
  resetPlayer: ReturnType<typeof makeResetPlayer>;
  social: Social;
  store: Store;
  trades: Trades;
  wallet: Wallet;
  wishlist: Wishlist;
  youtube: YoutubeService;
}>;

export function buildCapabilities(dependencies: CapabilityDependencies) {
  const { db, clock } = dependencies;
  return {
    ...wireAccountCapabilities({ ...dependencies, readers: accountOverviewReaders(dependencies) }),
    ...wireCatalogCapabilities(dependencies),
    ...wireDeckCapabilities(dependencies),
    ...wireDraftCapabilities(dependencies),
    ...wireInventoryCapabilities(dependencies),
    ...wirePackCapabilities(dependencies),
    ...wireRealCollectionCapabilities(dependencies),
    ...wireRedditCapabilities(dependencies),
    ...wireResetCapabilities(dependencies),
    ...wireSocialCapabilities(dependencies),
    ...wireStoreCapabilities(dependencies),
    ...wireTradeCapabilities(dependencies),
    ...wireWalletCapabilities(dependencies),
    ...wireWishlistCapabilities({
      ...dependencies,
      findCard: (nameOrId) => findCard(db, nameOrId),
    }),
    ...wireYoutubeCapabilities(dependencies),
    ...wireLookupCapabilities(dependencies),
    ...wireSiteCapabilities(dependencies),
    now: () => clock.now(),
  };
}

export type Capabilities = ReturnType<typeof buildCapabilities>;
