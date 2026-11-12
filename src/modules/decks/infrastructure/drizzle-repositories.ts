import { and, count, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, type Finish } from "@/modules/catalog";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type {
  CardLookup,
  CardQuery,
  CopyDeckSource,
  DeckRepository,
  ResolvedCard,
  ResolveOptions,
} from "../application/ports";
import { MOST_SPECIAL_FIRST, ownedCopies, STANDARD_FIRST } from "../queries/owned";
import {
  BOARDS,
  DeckId,
  DeckOrigin,
  FORMATS,
  GROUPINGS,
  type Deck,
  type Format,
  type PrintingFacts,
} from "../domain/deck";
import { isBracket } from "../domain/brackets";
import { tidyHeadings } from "../domain/headings";
import { isValidPublicToken } from "../domain/sharing";
import { SnapshotId, type DeckSnapshot, type SnapshotEntry } from "../domain/snapshots";
import { deckEntries, decks, deckSnapshots } from "./schema";

const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);
const SnapshotEntrySchema = z.object({
  oracleId: z.string(),
  board: z.enum(BOARDS),
  quantity: z.number().int(),
  printingId: z.string().nullable(),
  finish: FinishSchema.nullable(),
  heading: z.string().nullable(),
  note: z.string().nullable().default(null),
});

export function drizzleDeckRepository(db: DbExecutor): DeckRepository {
  async function create(input: {
    ownerId: UserId;
    name: string;
    format: Format;
    origin?: DeckOrigin | null;
    usesRealCards?: boolean;
    at: Date;
  }) {
    const [row] = await db
      .insert(decks)
      .values({
        ownerId: input.ownerId,
        name: input.name,
        format: input.format,
        origin: input.origin ? DeckOrigin.toText(input.origin) : null,
        // On for every new deck (design doc 16, section 7); decks made before it stay off.
        usesRealCards: input.usesRealCards ?? true,
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

  async function loadDeckWithEntries(
    row: typeof decks.$inferSelect | undefined,
  ): Promise<Deck | null> {
    if (row === undefined) return null;
    const entries = await db.select().from(deckEntries).where(eq(deckEntries.deckId, row.id));
    return {
      id: DeckId.of(row.id),
      ownerId: UserId.of(row.ownerId),
      name: row.name,
      format: z.enum(FORMATS).parse(row.format),
      usesRealCards: row.usesRealCards,
      targetBracket:
        row.targetBracket !== null && isBracket(row.targetBracket) ? row.targetBracket : null,
      grouping: z.enum(GROUPINGS).parse(row.grouping),
      headings: row.headingOrder,
      entries: entries.map((entry) => ({
        oracleId: entry.oracleId,
        board: z.enum(BOARDS).parse(entry.board),
        quantity: entry.quantity,
        printingId: entry.printingId === null ? null : PrintingId.of(entry.printingId),
        finish: entry.finish === null ? null : FinishSchema.parse(entry.finish),
        heading: entry.heading,
        note: entry.note,
      })),
    };
  }

  async function lockOwned(deckId: DeckId, ownerId: UserId): Promise<Deck | null> {
    const [row] = await db
      .select()
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.ownerId, ownerId)))
      .for("update");
    return loadDeckWithEntries(row);
  }

  async function findReadable(source: CopyDeckSource): Promise<Deck | null> {
    if (source.kind === "deck") {
      const [row] = await db
        .select()
        .from(decks)
        .where(
          and(
            eq(decks.id, source.deckId),
            or(eq(decks.ownerId, source.viewerId), eq(decks.visibility, "shared")),
          ),
        );
      return loadDeckWithEntries(row);
    }
    if (!isValidPublicToken(source.token)) return null;
    const [row] = await db.select().from(decks).where(eq(decks.publicToken, source.token));
    return loadDeckWithEntries(row);
  }

  async function save(untidy: Deck, at: Date): Promise<void> {
    const deck = tidyHeadings(untidy);
    await db
      .update(decks)
      .set({
        name: deck.name,
        format: deck.format,
        usesRealCards: deck.usesRealCards,
        targetBracket: deck.targetBracket,
        grouping: deck.grouping,
        headingOrder: [...deck.headings],
        updatedAt: at,
      })
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

  async function countSnapshots(deckId: DeckId): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(deckSnapshots)
      .where(eq(deckSnapshots.deckId, deckId));
    return row.total;
  }

  async function saveSnapshot(snapshot: Omit<DeckSnapshot, "id">): Promise<SnapshotId> {
    const [row] = await db
      .insert(deckSnapshots)
      .values({
        deckId: snapshot.deckId,
        label: snapshot.label,
        format: snapshot.format,
        targetBracket: snapshot.targetBracket,
        grouping: snapshot.grouping,
        headingOrder: [...snapshot.headings],
        entries: snapshot.entries.map((entry) => ({
          oracleId: entry.oracleId,
          board: entry.board,
          quantity: entry.quantity,
          printingId: entry.printingId,
          finish: entry.finish,
          heading: entry.heading,
          note: entry.note,
        })),
        createdAt: snapshot.createdAt,
      })
      .returning({ id: deckSnapshots.id });
    return SnapshotId.of(row.id);
  }

  async function getSnapshot(deckId: DeckId, snapshotId: SnapshotId): Promise<DeckSnapshot | null> {
    const [row] = await db
      .select()
      .from(deckSnapshots)
      .where(and(eq(deckSnapshots.id, snapshotId), eq(deckSnapshots.deckId, deckId)));
    if (row === undefined) return null;
    const rawEntries = z.array(SnapshotEntrySchema).parse(row.entries);
    const entries: SnapshotEntry[] = rawEntries.map((entry) => ({
      oracleId: entry.oracleId,
      board: entry.board,
      quantity: entry.quantity,
      printingId: entry.printingId === null ? null : PrintingId.of(entry.printingId),
      finish: entry.finish,
      heading: entry.heading,
      note: entry.note,
    }));
    return {
      id: SnapshotId.of(row.id),
      deckId: DeckId.of(row.deckId),
      label: row.label,
      format: z.enum(FORMATS).parse(row.format),
      targetBracket:
        row.targetBracket !== null && isBracket(row.targetBracket) ? row.targetBracket : null,
      grouping: z.enum(GROUPINGS).parse(row.grouping),
      headings: row.headingOrder,
      entries,
      createdAt: row.createdAt,
    };
  }

  async function deleteSnapshot(deckId: DeckId, snapshotId: SnapshotId): Promise<boolean> {
    const deleted = await db
      .delete(deckSnapshots)
      .where(and(eq(deckSnapshots.id, snapshotId), eq(deckSnapshots.deckId, deckId)))
      .returning({ id: deckSnapshots.id });
    return deleted.length > 0;
  }

  return {
    create,
    countFor,
    lockOwned,
    findReadable,
    save,
    delete: remove,
    deleteAllOf,
    countSnapshots,
    saveSnapshot,
    getSnapshot,
    deleteSnapshot,
  };
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
    options: ResolveOptions,
  ): Promise<Map<number, ResolvedCard>> {
    const found = new Map<number, ResolvedCard>();
    // The copies that count as this player's in the deck (real ones only if it uses them).
    const owned = ownedCopies(ownerId, sql`${options.includeReal}`);
    // An unowned line that names no printing: the cheapest printing in the store first (ties
    // and unpriced printings by the standard ranking), or just the standard ranking.
    const unnamedOrder =
      options.unnamedPrinting === "cheapest"
        ? sql`(select min(snapshot.usd_cents) from price_snapshots snapshot
                where snapshot.printing_id = p.id
                  and snapshot.day = (select max(day) from price_snapshots)) asc nulls last,
              ${STANDARD_FIRST}`
        : STANDARD_FIRST;
    // One small query per line: a pasted deck is at most about a hundred lines.
    for (const [index, query] of queries.entries()) {
      const setCode = query.setCode ?? "";
      const collectorNumber = query.collectorNumber ?? "";
      const [row] = (
        await db.execute<{ oracle_id: string; id: string; finish: string; named: boolean }>(sql`
          with candidates as (
            select p.* from printings p
             where lower(p.name) = lower(${query.name})
                or lower(split_part(p.name, ' // ', 1)) = lower(${query.name})
          ),
          -- The printing the line names: set and number, or just the set.
          named as (
            select p.id from candidates p join card_sets s on s.code = p.set_code
             where p.set_code = ${setCode}
             order by (p.collector_number = ${collectorNumber}) desc, s.release_date desc, p.id
             limit 1
          ),
          -- Otherwise your most special copy (design doc 23, section 14).
          special as (
            select c.printing_id as id, c.finish from ${owned} c
              join candidates p on p.id = c.printing_id
             order by ${MOST_SPECIAL_FIRST} limit 1
          ),
          -- Otherwise the card's standard printing (design doc 24, rule 2), or its cheapest.
          standard as (
            select p.id from candidates p join card_sets s on s.code = p.set_code
             order by ${unnamedOrder} limit 1
          ),
          chosen as (
            select coalesce((select id from named), (select id from special), (select id from standard)) as id
          )
          select p.oracle_id, p.id, (select id from named) is not null as named,
                 coalesce(
                   -- your most special copy of the chosen printing, then its usual finish
                   (select c.finish from ${owned} c where c.printing_id = p.id
                     order by ${MOST_SPECIAL_FIRST} limit 1),
                   case when 'nonfoil' = any(p.finishes) then 'nonfoil' else p.finishes[1] end
                 ) as finish
            from chosen join printings p on p.id = chosen.id
        `)
      ).rows;
      if (row !== undefined) {
        found.set(index, {
          oracleId: row.oracle_id,
          printingId: PrintingId.of(row.id),
          finish: FinishSchema.parse(row.finish),
          namedPrinting: row.named,
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

  async function printingFacts(printingId: PrintingId): Promise<PrintingFacts | null> {
    const [row] = (
      await db.execute<{ oracle_id: string; finishes: Finish[] }>(
        sql`select oracle_id, finishes from printings where id = ${printingId}`,
      )
    ).rows;
    return row === undefined ? null : { oracleId: row.oracle_id, finishes: row.finishes };
  }

  async function existingOracleIds(oracleIds: readonly string[]): Promise<Set<string>> {
    if (oracleIds.length === 0) return new Set();
    const rows = await db.execute<{ oracle_id: string }>(sql`
      select distinct oracle_id from printings where oracle_id = any(${sql.param([...new Set(oracleIds)])}::text[])
    `);
    return new Set(rows.rows.map((row) => row.oracle_id));
  }

  async function existingPrintings(printingIds: readonly PrintingId[]): Promise<Set<PrintingId>> {
    if (printingIds.length === 0) return new Set();
    const rows = await db.execute<{ id: string }>(sql`
      select id from printings where id = any(${sql.param([...new Set(printingIds)])}::text[])
    `);
    return new Set(rows.rows.map((row) => PrintingId.of(row.id)));
  }

  return {
    exists,
    printingFacts,
    resolve,
    oracleIdsOf,
    existingOracleIds,
    existingPrintings,
  };
}
