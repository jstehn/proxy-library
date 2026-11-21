import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { FinishSchema } from "@/shared/kernel";
import type { DbExecutor } from "@/shared/db";
import { BOARDS, DeckId, FORMATS, GROUPINGS, isBracket } from "@/modules/decks/core/client";
import { SnapshotId, type DeckSnapshot, type SnapshotEntry } from "../domain/snapshots";
import { deckSnapshots } from "./schema";
import type { SnapshotRepository } from "../application/ports";

const SnapshotEntrySchema = z.object({
  oracleId: z.string(),
  board: z.enum(BOARDS),
  quantity: z.number().int(),
  printingId: z.string().nullable(),
  finish: FinishSchema.nullable(),
  heading: z.string().nullable(),
  note: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  role: z.string().nullable().default(null),
  pinned: z.boolean().default(false),
});

export function drizzleSnapshotRepository(db: DbExecutor): SnapshotRepository {
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
          tags: [...(entry.tags ?? [])],
          role: entry.role ?? null,
          pinned: entry.pinned ?? false,
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
      tags: entry.tags,
      ...(entry.role !== null ? { role: entry.role } : {}),
      ...(entry.pinned ? { pinned: true } : {}),
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

  return { countSnapshots, saveSnapshot, getSnapshot, deleteSnapshot };
}
