import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type { CardLookup, CardQuery, DeckRepository, ResolvedCard } from "../application/ports";
import { BOARDS, DeckId, FORMATS, type Deck, type Format } from "../domain/deck";
import { deckEntries, decks } from "./schema";

const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

export function drizzleDeckRepository(db: DbExecutor): DeckRepository {
  async function create(input: { ownerId: UserId; name: string; format: Format; at: Date }) {
    const [row] = await db
      .insert(decks)
      .values({
        ownerId: input.ownerId,
        name: input.name,
        format: input.format,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning({ id: decks.id });
    return DeckId.of(row.id);
  }

  async function countFor(ownerId: UserId): Promise<number> {
    const [row] = await db.select({ total: count() }).from(decks).where(eq(decks.ownerId, ownerId));
    return row.total;
  }

  async function lockOwned(deckId: DeckId, ownerId: UserId): Promise<Deck | null> {
    const [row] = await db
      .select()
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.ownerId, ownerId)))
      .for("update");
    if (row === undefined) return null;
    const entries = await db.select().from(deckEntries).where(eq(deckEntries.deckId, deckId));
    return {
      id: DeckId.of(row.id),
      ownerId: UserId.of(row.ownerId),
      name: row.name,
      format: z.enum(FORMATS).parse(row.format),
      entries: entries.map((entry) => ({
        oracleId: entry.oracleId,
        board: z.enum(BOARDS).parse(entry.board),
        quantity: entry.quantity,
        printingId: entry.printingId === null ? null : PrintingId.of(entry.printingId),
        finish: entry.finish === null ? null : FinishSchema.parse(entry.finish),
      })),
    };
  }

  async function save(deck: Deck, at: Date): Promise<void> {
    await db
      .update(decks)
      .set({ name: deck.name, format: deck.format, updatedAt: at })
      .where(eq(decks.id, deck.id));
    // Replace the entries: simpler than working out what changed, and a deck is small.
    await db.delete(deckEntries).where(eq(deckEntries.deckId, deck.id));
    if (deck.entries.length > 0) {
      await db
        .insert(deckEntries)
        .values(deck.entries.map((entry) => ({ ...entry, deckId: deck.id })));
    }
  }

  async function remove(deckId: DeckId): Promise<void> {
    await db.delete(decks).where(eq(decks.id, deckId)); // entries go with it (on delete cascade)
  }

  async function deleteAllOf(ownerId: UserId): Promise<number> {
    const deleted = await db
      .delete(decks)
      .where(eq(decks.ownerId, ownerId))
      .returning({ id: decks.id }); // entries go with them (on delete cascade)
    return deleted.length;
  }

  return { create, countFor, lockOwned, save, delete: remove, deleteAllOf };
}

export function drizzleCardLookup(db: DbExecutor): CardLookup {
  async function exists(oracleId: string): Promise<boolean> {
    const result = await db.execute(
      sql`select 1 from printings where oracle_id = ${oracleId} limit 1`,
    );
    return result.rows.length > 0;
  }

  async function resolve(
    ownerId: UserId,
    queries: readonly CardQuery[],
  ): Promise<Map<number, ResolvedCard>> {
    const found = new Map<number, ResolvedCard>();
    // One small query per line: a pasted deck is at most about a hundred lines.
    for (const [index, query] of queries.entries()) {
      const [row] = (
        await db.execute<{ oracle_id: string; id: string; finish: string }>(sql`
          select p.oracle_id, p.id,
                 coalesce(owned.finish, case when 'nonfoil' = any(p.finishes) then 'nonfoil' else p.finishes[1] end) as finish
            from printings p
            join card_sets s on s.code = p.set_code
            left join lateral (
              select c.finish, c.quantity from collection_cards c
               where c.user_id = ${ownerId} and c.printing_id = p.id
               order by c.quantity desc limit 1
            ) owned on true
           where lower(p.name) = lower(${query.name})
              or lower(split_part(p.name, ' // ', 1)) = lower(${query.name})
           order by (p.set_code = ${query.setCode ?? ""} and p.collector_number = ${query.collectorNumber ?? ""}) desc,
                    p.set_code = ${query.setCode ?? ""} desc,
                    owned.quantity is not null desc,
                    s.release_date desc, p.id
           limit 1
        `)
      ).rows;
      if (row !== undefined) {
        found.set(index, {
          oracleId: row.oracle_id,
          printingId: PrintingId.of(row.id),
          finish: FinishSchema.parse(row.finish),
        });
      }
    }
    return found;
  }

  async function oracleIdsOf(printingIds: readonly PrintingId[]): Promise<Map<PrintingId, string>> {
    if (printingIds.length === 0) return new Map();
    const rows = await db.execute<{ id: string; oracle_id: string }>(sql`
      select id, oracle_id from printings where id = any(${sql.param([...new Set(printingIds)])}::text[])
    `);
    return new Map(rows.rows.map((row) => [PrintingId.of(row.id), row.oracle_id]));
  }

  return { exists, resolve, oracleIdsOf };
}
