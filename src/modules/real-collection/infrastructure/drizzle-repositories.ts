import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, SealedProductId, type Finish } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type { PrintingMatcher, RealCollectionRepository } from "../application/ports";
import type { RealCopy } from "../domain/copies";
import { normalizedName, type PrintingCandidate } from "../domain/match";
import { printings } from "../../catalog/infrastructure/schema";
import { realCards, realCollectionSettings, realProducts } from "./schema";

// Postgres allows at most 65535 parameters per statement; 500 rows keeps well under that.
const CHUNK = 500;

/** `excluded.<column>`: in an upsert, the value from the row we tried to insert. */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

export function drizzleRealCollectionRepository(db: DbExecutor): RealCollectionRepository {
  /** Inserts or overwrites rows with these quantities. */
  async function upsert(userId: UserId, copies: readonly RealCopy[], at: Date) {
    for (let start = 0; start < copies.length; start += CHUNK) {
      const batch = copies.slice(start, start + CHUNK);
      await db
        .insert(realCards)
        .values(batch.map((copy) => ({ userId, ...copy, addedAt: at, updatedAt: at })))
        .onConflictDoUpdate({
          target: [realCards.userId, realCards.printingId, realCards.finish],
          set: { quantity: excluded("quantity"), updatedAt: at },
        });
    }
  }

  async function remove(userId: UserId, copies: readonly RealCopy[]) {
    for (const copy of copies) {
      await db
        .delete(realCards)
        .where(
          and(
            eq(realCards.userId, userId),
            eq(realCards.printingId, copy.printingId),
            eq(realCards.finish, copy.finish),
          ),
        );
    }
  }

  return {
    async lock(userId) {
      // A lock on the player's collection rather than on rows: it also covers rows that don't
      // exist yet. Released when the transaction ends.
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`real-collection:${userId}`}))`);
    },

    async copies(userId) {
      const rows = await db
        .select({
          printingId: realCards.printingId,
          finish: realCards.finish,
          quantity: realCards.quantity,
        })
        .from(realCards)
        .where(eq(realCards.userId, userId));
      return rows.map((row) => ({
        printingId: PrintingId.of(row.printingId),
        // The database only allows these three (a CHECK constraint).
        finish: row.finish as Finish,
        quantity: row.quantity,
      }));
    },

    async version(userId) {
      const [row] = (
        await db.execute<{ updated_at: Date | null; rows: number }>(sql`
          select max(updated_at) as updated_at, count(*)::int as rows
            from real_cards where user_id = ${userId}
        `)
      ).rows;
      return {
        updatedAt: row.updated_at === null ? null : new Date(row.updated_at).toISOString(),
        rows: row.rows,
      };
    },

    async set(userId, copy, at) {
      if (copy.quantity === 0) await remove(userId, [copy]);
      else await upsert(userId, [copy], at);
    },

    async apply(userId, plan, at) {
      await remove(userId, plan.removed);
      await upsert(
        userId,
        [...plan.changed, ...plan.added].map(({ printingId, finish, quantity }) => ({
          printingId,
          finish,
          quantity,
        })),
        at,
      );
    },

    async clear(userId) {
      const removed = await db
        .delete(realCards)
        .where(eq(realCards.userId, userId))
        .returning({ id: realCards.printingId });
      return removed.length;
    },

    async setShared(userId, isShared, at) {
      await db
        .insert(realCollectionSettings)
        .values({ userId, isShared, updatedAt: at })
        .onConflictDoUpdate({
          target: realCollectionSettings.userId,
          set: { isShared, updatedAt: at },
        });
    },

    async addProduct(userId, productId, choices, at) {
      const [row] = await db
        .insert(realProducts)
        .values({ userId, productId, choices: [...choices], addedAt: at })
        .returning({ id: realProducts.id });
      return row.id;
    },

    async findProduct(realProductId, userId) {
      const [row] = await db
        .select()
        .from(realProducts)
        .where(and(eq(realProducts.id, realProductId), eq(realProducts.userId, userId)));
      if (row === undefined) return null;
      return {
        id: row.id,
        userId: UserId.of(row.userId),
        productId: SealedProductId.of(row.productId),
        choices: z.array(z.number().int().nonnegative()).parse(row.choices),
      };
    },

    async removeProduct(realProductId) {
      await db.delete(realProducts).where(eq(realProducts.id, realProductId));
    },
  };
}

const FinishesSchema = z.array(z.enum(["nonfoil", "foil", "etched"]));

/** Matches import lines against the catalog's printings (design doc 16, section 8). */
export function sqlPrintingMatcher(db: DbExecutor): PrintingMatcher {
  return {
    async candidates(lines) {
      const names = [...new Set(lines.map((line) => normalizedName(line.name)))];
      const scryfallIds = [
        ...new Set(lines.flatMap((line) => (line.scryfallId === null ? [] : [line.scryfallId]))),
      ];
      // One query for the whole import: every printing of every named card, matching the full
      // name or the front face's ("Fire" for "Fire // Ice"), plus the exact Scryfall ids.
      const rows = await db.execute<{
        id: string;
        oracle_id: string;
        name: string;
        set_code: string;
        collector_number: string;
        set_type: string;
        release_date: string;
        finishes: string[];
        border_color: string;
        frame_effects: string[];
        promo_types: string[];
        is_full_art: boolean;
        scryfall_id: string;
      }>(sql`
        select p.id, p.oracle_id, p.name, p.set_code, p.collector_number, s.type as set_type,
               s.release_date, p.finishes, p.border_color, p.frame_effects, p.promo_types,
               p.is_full_art, p.scryfall_id
          from printings p join card_sets s on s.code = p.set_code
         where lower(p.name) = any(${sql.param(names)}::text[])
            or lower(split_part(p.name, ' // ', 1)) = any(${sql.param(names)}::text[])
            or p.scryfall_id = any(${sql.param(scryfallIds)}::text[])
      `);

      const byName = new Map<string, PrintingCandidate[]>();
      const byScryfallId = new Map<string, PrintingCandidate>();
      for (const row of rows.rows) {
        const printing: PrintingCandidate = {
          printingId: PrintingId.of(row.id),
          oracleId: row.oracle_id,
          setCode: row.set_code,
          collectorNumber: row.collector_number,
          setType: row.set_type,
          releaseDate: row.release_date,
          finishes: FinishesSchema.parse(row.finishes),
          borderColor: row.border_color,
          frameEffects: row.frame_effects,
          promoTypes: row.promo_types,
          isFullArt: row.is_full_art,
        };
        byScryfallId.set(row.scryfall_id, printing);
        const keys = new Set([normalizedName(row.name), normalizedName(row.name.split(" // ")[0])]);
        for (const key of keys) byName.set(key, [...(byName.get(key) ?? []), printing]);
      }
      return { byName, byScryfallId };
    },

    async facts(printingIds) {
      if (printingIds.length === 0) return new Map();
      const rows = await db
        .select({ id: printings.id, oracleId: printings.oracleId, finishes: printings.finishes })
        .from(printings)
        .where(inArray(printings.id, [...printingIds]));
      return new Map(
        rows.map((row) => [
          PrintingId.of(row.id),
          { oracleId: row.oracleId, finishes: FinishesSchema.parse(row.finishes) },
        ]),
      );
    },
  };
}
