import { and, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type {
  CatalogRepository,
  PricingPrinting,
  SetState,
  SyncKind,
  SyncRunRepository,
} from "../application/ports";
import { PrintingId, SetCode, type Finish, type ImageUris } from "../domain/types";
import {
  boosterConfigs,
  cardSets,
  deckLists,
  priceSnapshots,
  printings,
  sealedProducts,
  syncRuns,
} from "./schema";

// Postgres allows at most 65535 parameters per statement; 500 rows keeps well under that.
const CHUNK = 500;
function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** `excluded.<column>`: in an upsert, the value from the row we tried to insert. */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

export function drizzleCatalogRepository(db: DbExecutor): CatalogRepository {
  return {
    async saveSetList(sets) {
      for (const batch of chunks(sets)) {
        await db
          .insert(cardSets)
          .values(batch.map((set) => ({ ...set, parentCode: set.parentCode })))
          .onConflictDoUpdate({
            target: cardSets.code,
            set: {
              name: excluded("name"),
              releaseDate: excluded("release_date"),
              type: excluded("type"),
              keyruneCode: excluded("keyrune_code"),
              parentCode: excluded("parent_code"),
            },
          });
      }
    },

    async setStates() {
      const rows = await db
        .select({
          code: cardSets.code,
          type: cardSets.type,
          parentCode: cardSets.parentCode,
          name: cardSets.name,
          releaseDate: cardSets.releaseDate,
          isEnabled: cardSets.isEnabled,
          isSupporting: cardSets.isSupporting,
          importedVersion: cardSets.importedVersion,
          printingCount: count(printings.id),
        })
        .from(cardSets)
        .leftJoin(printings, eq(printings.setCode, cardSets.code))
        .groupBy(cardSets.code);
      return rows.map((row): SetState => ({
        ...row,
        code: SetCode.of(row.code),
        parentCode: row.parentCode === null ? null : SetCode.of(row.parentCode),
      }));
    },

    async setEnabled(codes, enabled) {
      if (codes.length === 0) return;
      await db
        .update(cardSets)
        .set({ isEnabled: enabled })
        .where(inArray(cardSets.code, [...codes]));
    },

    async markStandard(codes) {
      await db
        .update(cardSets)
        .set({ isStandard: true })
        .where(inArray(cardSets.code, [...codes]));
      await db
        .update(cardSets)
        .set({ isStandard: false })
        .where(codes.length === 0 ? sql`true` : notInArray(cardSets.code, [...codes]));
    },

    async standardSetCodes() {
      const rows = await db
        .select({ code: cardSets.code })
        .from(cardSets)
        .where(eq(cardSets.isStandard, true));
      return rows.map((row) => SetCode.of(row.code));
    },

    async saveImport(setImport, options) {
      const code = setImport.set.code;
      for (const batch of chunks(setImport.printings)) {
        await db
          .insert(printings)
          .values(
            batch.map((printing) => ({
              id: printing.id,
              setCode: printing.setCode,
              collectorNumber: printing.collectorNumber,
              name: printing.name,
              oracleId: printing.oracleId,
              scryfallId: printing.scryfallId,
              rarity: printing.rarity,
              colors: [...printing.colors],
              colorIdentity: [...printing.colorIdentity],
              manaCost: printing.manaCost,
              manaValue: printing.manaValue,
              typeLine: printing.typeLine,
              layout: printing.layout,
              finishes: [...printing.finishes],
              borderColor: printing.treatments.borderColor,
              frameVersion: printing.treatments.frameVersion,
              frameEffects: [...printing.treatments.frameEffects],
              promoTypes: [...printing.treatments.promoTypes],
              isFullArt: printing.treatments.isFullArt,
              variantLabel: printing.variantLabel,
              faces: printing.faces,
              artist: printing.artist,
            })),
          )
          .onConflictDoUpdate({
            target: printings.id,
            set: {
              name: excluded("name"),
              collectorNumber: excluded("collector_number"),
              rarity: excluded("rarity"),
              colors: excluded("colors"),
              colorIdentity: excluded("color_identity"),
              manaCost: excluded("mana_cost"),
              manaValue: excluded("mana_value"),
              typeLine: excluded("type_line"),
              layout: excluded("layout"),
              finishes: excluded("finishes"),
              borderColor: excluded("border_color"),
              frameVersion: excluded("frame_version"),
              frameEffects: excluded("frame_effects"),
              promoTypes: excluded("promo_types"),
              isFullArt: excluded("is_full_art"),
              variantLabel: excluded("variant_label"),
              faces: excluded("faces"),
              artist: excluded("artist"),
              updatedAt: sql`now()`,
            },
          });
      }

      if (options.printingsOnly) {
        await db.update(cardSets).set({ isSupporting: true }).where(eq(cardSets.code, code));
        return;
      }

      for (const booster of setImport.boosters) {
        const row = {
          setCode: booster.setCode,
          boosterType: booster.boosterType,
          variants: booster.variants,
          sheets: booster.sheets,
          sourceSetCodes: [...booster.sourceSetCodes],
        };
        await db
          .insert(boosterConfigs)
          .values(row)
          .onConflictDoUpdate({
            target: [boosterConfigs.setCode, boosterConfigs.boosterType],
            set: { variants: row.variants, sheets: row.sheets, sourceSetCodes: row.sourceSetCodes },
          });
      }
      for (const product of setImport.products) {
        await db
          .insert(sealedProducts)
          .values({ ...product, contents: product.contents })
          .onConflictDoUpdate({
            target: sealedProducts.id,
            set: {
              isListed: true,
              name: product.name,
              category: product.category,
              subtype: product.subtype,
              releaseDate: product.releaseDate,
              contents: product.contents,
            },
          });
      }
      // Products this import didn't include are no longer sold (rule 5b; design doc 11).
      const listed = setImport.products.map((product) => product.id as string);
      await db
        .update(sealedProducts)
        .set({ isListed: sql`${sealedProducts.id} = any(${sql.param(listed)}::text[])` })
        .where(eq(sealedProducts.setCode, code));
      for (const deck of setImport.decks) {
        const row = { ...deck, cards: deck.cards, sourceSetCodes: [...deck.sourceSetCodes] };
        await db
          .insert(deckLists)
          .values(row)
          .onConflictDoUpdate({
            target: [deckLists.setCode, deckLists.name],
            set: { type: row.type, cards: row.cards, sourceSetCodes: row.sourceSetCodes },
          });
      }
      await db
        .update(cardSets)
        .set({ importedVersion: setImport.version, importedAt: options.importedAt })
        .where(eq(cardSets.code, code));
    },

    async knownReferences(importingSet) {
      // The set being imported is replaced by its new import, so its own old products, boosters
      // and decks don't count: the import's contents are checked against themselves instead.
      const otherSets = <T extends { setCode: string }>(rows: T[]) =>
        rows.filter((row) => row.setCode !== importingSet);
      // One query at a time: a transaction is a single connection, and pg is dropping support
      // for overlapping queries on one connection (Promise.all here logged a deprecation warning).
      const printingRows = await db.select({ id: printings.id }).from(printings);
      // Unlisted products (left out or dropped) don't count as known.
      const productRows = await db
        .select({ id: sealedProducts.id, setCode: sealedProducts.setCode })
        .from(sealedProducts)
        .where(eq(sealedProducts.isListed, true));
      const boosterRows = await db
        .select({ setCode: boosterConfigs.setCode, boosterType: boosterConfigs.boosterType })
        .from(boosterConfigs);
      // A deck list with no cards doesn't count as known (rule 5b): an old row can linger
      // after MTGJSON listed the deck before its cards.
      const deckRows = await db
        .select({ setCode: deckLists.setCode, name: deckLists.name })
        .from(deckLists)
        .where(sql`jsonb_array_length(${deckLists.cards}) > 0`);
      return {
        printingIds: new Set(printingRows.map((row) => row.id)),
        productIds: new Set(otherSets(productRows).map((row) => row.id)),
        boosters: new Set(otherSets(boosterRows).map((row) => `${row.setCode}/${row.boosterType}`)),
        decks: new Set(otherSets(deckRows).map((row) => `${row.setCode}/${row.name}`)),
      };
    },

    async printingsForPricing() {
      const rows = await db
        .select({
          id: printings.id,
          scryfallId: printings.scryfallId,
          finishes: printings.finishes,
        })
        .from(printings);
      return new Map(
        rows.map((row): [string, PricingPrinting] => [
          row.scryfallId,
          { id: PrintingId.of(row.id), finishes: row.finishes as Finish[] },
        ]),
      );
    },

    async savePriceSnapshots(snapshots) {
      for (const batch of chunks(snapshots)) {
        await db
          .insert(priceSnapshots)
          .values(
            batch.map((snapshot) => ({
              printingId: snapshot.printingId,
              finish: snapshot.finish,
              day: snapshot.day,
              usdCents: snapshot.price,
            })),
          )
          // Rule 7: re-running on the same day replaces that day's price; other days are untouched.
          .onConflictDoUpdate({
            target: [priceSnapshots.printingId, priceSnapshots.finish, priceSnapshots.day],
            set: { usdCents: excluded("usd_cents") },
          });
      }
    },

    async saveCardExtras(extras) {
      for (const card of extras) {
        await db
          .update(printings)
          .set({
            imageUris: card.images,
            legalities: card.legalities,
            producedMana: [...card.producedMana],
            keywords: [...card.keywords],
          })
          .where(eq(printings.scryfallId, card.scryfallId));
      }
    },

    async imageSource(printingId) {
      const [row] = await db
        .select({ scryfallId: printings.scryfallId, imageUris: printings.imageUris })
        .from(printings)
        .where(eq(printings.id, printingId));
      if (row === undefined) return null;
      // Written by this module from Scryfall's parsed data, so its shape is known.
      return { scryfallId: row.scryfallId, images: row.imageUris as ImageUris | null };
    },
  };
}

// An arbitrary fixed number naming the "one sync at a time" lock (design doc 04, rule 6).
const SYNC_LOCK_ID = 42_004;

export function drizzleSyncRunRepository(db: DbExecutor): SyncRunRepository {
  return {
    async queue(run) {
      await db.insert(syncRuns).values({
        kind: run.kind,
        status: "queued",
        requestedBy: run.requestedBy,
        requestedAt: run.requestedAt,
      });
    },

    async hasPending() {
      const [row] = await db
        .select({ total: count() })
        .from(syncRuns)
        .where(inArray(syncRuns.status, ["queued", "running"]));
      return row.total > 0;
    },

    async claimNext(now) {
      await db.execute(sql`select pg_advisory_xact_lock(${SYNC_LOCK_ID})`);
      const [running] = await db
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(eq(syncRuns.status, "running"))
        .limit(1);
      if (running !== undefined) return null;

      const [next] = await db
        .select({ id: syncRuns.id, kind: syncRuns.kind })
        .from(syncRuns)
        .where(eq(syncRuns.status, "queued"))
        .orderBy(syncRuns.requestedAt)
        .limit(1);
      if (next === undefined) return null;

      await db
        .update(syncRuns)
        .set({ status: "running", startedAt: now })
        .where(eq(syncRuns.id, next.id));
      return { id: next.id, kind: next.kind as SyncKind };
    },

    async finish(id, result) {
      await db
        .update(syncRuns)
        .set({
          status: result.status,
          summary: result.summary,
          error: result.error,
          finishedAt: result.finishedAt,
        })
        .where(eq(syncRuns.id, id));
    },

    async failInterrupted(now) {
      const updated = await db
        .update(syncRuns)
        .set({
          status: "failed",
          error: "interrupted (the worker stopped mid-run)",
          finishedAt: now,
        })
        .where(eq(syncRuns.status, "running"))
        .returning({ id: syncRuns.id });
      return updated.length;
    },

    async lastStartedAt() {
      const [row] = await db
        .select({ startedAt: syncRuns.startedAt })
        .from(syncRuns)
        .where(and(sql`${syncRuns.startedAt} is not null`))
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);
      return row?.startedAt ?? null;
    },
  };
}
