// Shared wiring for cross-module integration tests: the real Drizzle repositories of every
// module, the catalog loaded from recorded fixtures (no network), and players made with SQL.
import { sql } from "drizzle-orm";
import type { Actor } from "@/modules/accounts";
import { drizzleEventRecorder } from "@/modules/activity/infrastructure";
import { makeCatalog } from "@/modules/catalog";
import {
  drizzleArtworkRepository,
  drizzleCatalogRepository,
  drizzleSyncRunRepository,
  fixtureMtgjsonGateway,
  fixtureScryfallGateway,
  fixtureWpnGateway,
  memoryArtworkStore,
} from "@/modules/catalog/infrastructure";
import { drizzleCollectionRepository } from "@/modules/collection/infrastructure";
import { drizzleCardLookup, drizzleDeckRepository } from "@/modules/decks/infrastructure";
import {
  drizzleDraftCatalog,
  drizzleDraftRepository,
  pgDraftNotifier,
} from "@/modules/drafts/infrastructure";
import {
  drizzleHoldings,
  drizzleTradePlayers,
  drizzleTradeRepository,
} from "@/modules/trades/infrastructure";
import { drizzleItemRepository, drizzleProductCatalog } from "@/modules/inventory/infrastructure";
import { drizzleBoosterSource } from "@/modules/packs/infrastructure";
import {
  drizzleMarketPrices,
  drizzlePriceList,
  drizzleStoreLedger,
  drizzleStoreSettings,
} from "@/modules/store/infrastructure";
import {
  drizzleEconomySettingsRepository,
  drizzlePlayerDirectory,
  drizzleWalletRepository,
} from "@/modules/wallet/infrastructure";
import { loadConfig } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork, type DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import { systemClock } from "@/shared/runtime";

export const { db, close } = createDatabase(loadConfig().databaseUrl);
export const clock = systemClock();

/** Every module's repositories inside one transaction, like the app's composition root. */
export function servicesFor(transaction: DbExecutor) {
  return {
    catalog: drizzleCatalogRepository(transaction),
    syncRuns: drizzleSyncRunRepository(transaction),
    artwork: drizzleArtworkRepository(transaction),
    wallets: drizzleWalletRepository(transaction),
    economy: drizzleEconomySettingsRepository(transaction),
    playerDirectory: drizzlePlayerDirectory(transaction),
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
    drafts: drizzleDraftRepository(transaction),
    draftCatalog: drizzleDraftCatalog(transaction),
    draftNotifier: pgDraftNotifier(transaction),
  };
}

export const unitOfWork = makeDrizzleUnitOfWork(db, servicesFor);

/** A fresh catalog from the recorded fixtures: Bloomburrow, enabled as a Standard set. */
export async function loadFixtureCatalog(): Promise<void> {
  await db.execute(
    sql`truncate sync_runs, price_snapshots, deck_lists, sealed_products, booster_configs, printings, card_sets, artwork_files cascade`,
  );
  const catalog = makeCatalog({
    unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
      catalog: drizzleCatalogRepository(transaction),
      syncRuns: drizzleSyncRunRepository(transaction),
      artwork: drizzleArtworkRepository(transaction),
    })),
    mtgjson: fixtureMtgjsonGateway(),
    scryfall: fixtureScryfallGateway(),
    images: { get: async () => null, put: async () => undefined },
    imageFetcher: { fetch: async () => new Uint8Array() },
    wpn: fixtureWpnGateway(),
    artworkFiles: memoryArtworkStore(),
    clock,
    syncTime: { hour: 4, minute: 0 },
  });
  await catalog.runSync("prices");
}

/**
 * Empties every player's data and creates these players, with known money rules: a $50
 * starting grant and no allowance (whatever earlier tests left in the settings), and the
 * store buying at 50%.
 */
export async function resetPlayers(ids: readonly string[]): Promise<void> {
  await db.execute(sql`truncate invites, players, auth_users cascade`);
  await db.execute(sql`truncate msrp_overrides`);
  for (const id of ids) {
    await db.execute(
      sql`insert into auth_users (id, name, email, username) values (${id}, ${id}, ${`${id}@players.invalid`}, ${id})`,
    );
    await db.execute(sql`insert into players (user_id, created_at) values (${id}, now())`);
  }
  await db.execute(
    sql`update economy_settings set starting_grant_cents = 5000, allowance_cents = 0 where id = 1`,
  );
  await db.execute(sql`update store_settings set buylist_rate_bps = 5000 where id = 1`);
}

export function actor(id: string, isAdmin = false): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

export async function count(table: string, where = "true"): Promise<number> {
  const result = await db.execute<{ total: number }>(
    sql.raw(`select count(*)::int as total from ${table} where ${where}`),
  );
  return result.rows[0].total;
}

export async function balance(userId: string): Promise<number> {
  const result = await db.execute<{ total: number }>(
    sql`select coalesce(sum(amount_cents), 0)::int as total from ledger_entries where user_id = ${userId}`,
  );
  return result.rows[0].total;
}
