import { count, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import type { CardFace, Finish } from "../domain/types";
import { cardSets, printings, syncRuns } from "../infrastructure/schema";

// Read models for the catalog screens (ADR 0006): plain objects, ready to render.

export type AdminSetRow = Readonly<{
  code: string;
  name: string;
  releaseDate: string;
  type: string;
  isEnabled: boolean;
  isSupporting: boolean;
  isStandard: boolean;
  printingCount: number;
}>;

export async function listSetsForAdmin(db: DbExecutor): Promise<AdminSetRow[]> {
  return db
    .select({
      code: cardSets.code,
      name: cardSets.name,
      releaseDate: cardSets.releaseDate,
      type: cardSets.type,
      isEnabled: cardSets.isEnabled,
      isSupporting: cardSets.isSupporting,
      isStandard: cardSets.isStandard,
      printingCount: count(printings.id),
    })
    .from(cardSets)
    .leftJoin(printings, eq(printings.setCode, cardSets.code))
    .groupBy(cardSets.code)
    .orderBy(desc(cardSets.releaseDate), cardSets.code);
}

export type SetSummary = Readonly<{
  code: string;
  name: string;
  releaseDate: string;
  keyruneCode: string;
  printingCount: number;
}>;

/** Enabled sets that have been imported, newest first. */
export async function enabledSets(db: DbExecutor): Promise<SetSummary[]> {
  const rows = await db
    .select({
      code: cardSets.code,
      name: cardSets.name,
      releaseDate: cardSets.releaseDate,
      keyruneCode: cardSets.keyruneCode,
      printingCount: count(printings.id),
    })
    .from(cardSets)
    .innerJoin(printings, eq(printings.setCode, cardSets.code))
    .where(eq(cardSets.isEnabled, true))
    .groupBy(cardSets.code)
    .orderBy(desc(cardSets.releaseDate));
  return rows;
}

export async function findSet(db: DbExecutor, code: string): Promise<SetSummary | null> {
  const [row] = await db
    .select({
      code: cardSets.code,
      name: cardSets.name,
      releaseDate: cardSets.releaseDate,
      keyruneCode: cardSets.keyruneCode,
      printingCount: count(printings.id),
    })
    .from(cardSets)
    .leftJoin(printings, eq(printings.setCode, cardSets.code))
    .where(eq(cardSets.code, code.toUpperCase()))
    .groupBy(cardSets.code);
  return row ?? null;
}

export type PrintingCard = Readonly<{
  id: string;
  name: string;
  collectorNumber: string;
  rarity: string;
  variantLabel: string;
  finishes: Finish[];
  hasImage: boolean;
  /** What's printed on each face (front first), for the hover overlay. */
  faces: CardFace[];
  artist: string | null;
  /** Latest market price per finish; a finish is missing when there's no price. */
  prices: Partial<Record<Finish, Cents>>;
}>;

/** A set's printings in collector-number order, each with its latest price per finish. */
export async function setPrintings(db: DbExecutor, code: string): Promise<PrintingCard[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    collector_number: string;
    rarity: string;
    variant_label: string;
    finishes: Finish[];
    has_image: boolean;
    faces: CardFace[];
    artist: string | null;
    prices: Record<string, number> | null;
  }>(sql`
    select p.id, p.name, p.collector_number, p.rarity, p.variant_label, p.finishes,
           p.image_uris is not null as has_image, p.faces, p.artist,
           -- For each finish, the newest snapshot's price ("distinct on" keeps the first row per finish).
           (select jsonb_object_agg(latest.finish, latest.usd_cents)
              from (select distinct on (s.finish) s.finish, s.usd_cents
                      from price_snapshots s
                     where s.printing_id = p.id
                     order by s.finish, s.day desc) latest) as prices
      from printings p
     where p.set_code = ${code.toUpperCase()}
     -- "12" before "100", and "A-12" style numbers after plain ones.
     order by nullif(regexp_replace(p.collector_number, '\\D', '', 'g'), '')::int nulls last,
              p.collector_number
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    variantLabel: row.variant_label,
    finishes: row.finishes,
    hasImage: row.has_image,
    faces: row.faces,
    artist: row.artist,
    prices: Object.fromEntries(
      Object.entries(row.prices ?? {}).map(([finish, cents]) => [finish, Cents.of(Number(cents))]),
    ),
  }));
}

export type SyncRunRow = Readonly<{
  id: number;
  kind: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
}>;

export async function recentSyncRuns(db: DbExecutor, limit = 20): Promise<SyncRunRow[]> {
  const rows = await db.select().from(syncRuns).orderBy(desc(syncRuns.requestedAt)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    // Written by this module as a SyncSummary object, so this shape is known.
    summary: row.summary as Record<string, unknown> | null,
    error: row.error,
  }));
}
