import { cardTags, cardThemes } from "@/shared/card-search";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { isPlayed } from "../domain/boards";
import { isBracket, type Bracket } from "../domain/brackets";
import { BOARDS, DeckId, FORMATS, type Format } from "../domain/deck";
import { scoreDeck, type DeckScore, type OptimizerCard } from "../domain/optimize";
import { compareDeckStates, type ChangePreview, type PreviewLine } from "../domain/preview";
import { SnapshotId, type SnapshotSummary } from "../domain/snapshots";
import { decks, deckSnapshots } from "../infrastructure/schema";
import { deckView } from "./decks";
import { lineToPreview, loadCardsForPreview, viewFingerprint } from "./preview";

// Read models for deck snapshots and before/after comparisons (design doc 41).

const StoredSnapshotEntrySchema = z.object({
  oracleId: z.string(),
  board: z.enum(BOARDS),
  quantity: z.number().int(),
});

type StoredSnapshot = Readonly<{
  id: number;
  label: string;
  format: Format;
  targetBracket: Bracket | null;
  entries: readonly z.infer<typeof StoredSnapshotEntrySchema>[];
  createdAt: Date;
}>;

export type SnapshotComparisonSide = Readonly<{
  snapshotId: number | null;
  label: string;
  format: Format;
  createdAt: string | null;
}>;

export type SnapshotComparison = ChangePreview &
  Readonly<{
    deck: Readonly<{ id: number; name: string; format: Format }>;
    fingerprint: string;
    beforeSide: SnapshotComparisonSide;
    afterSide: SnapshotComparisonSide;
    scoreBefore: DeckScore;
    scoreAfter: DeckScore;
    scoreDelta: number;
  }>;

function previewLineToOptimizerCard(line: PreviewLine): OptimizerCard {
  const facts = {
    typeLine: line.typeLine,
    text: line.text,
    producedMana: line.producedMana,
  };
  return {
    oracleId: line.oracleId,
    name: line.name,
    typeLine: line.typeLine,
    manaValue: line.manaValue,
    manaCost: line.manaCost,
    text: line.text,
    producedMana: line.producedMana,
    keywords: [],
    roles: cardTags(facts),
    themes: cardThemes(facts),
    rarity: "common",
    priceCents: line.priceCents,
    isGameChanger: line.isGameChanger,
    board: line.board,
    quantity: line.quantity,
  };
}

/** Lists saved snapshots for one of the player's decks, newest first; null if not owned. */
export async function listDeckSnapshots(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<SnapshotSummary[] | null> {
  const [ownerRow] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerId, userId)));
  if (ownerRow === undefined) return null;

  const rows = await db.execute<{
    id: number;
    deck_id: number;
    label: string;
    format: string;
    card_count: number;
    created_at: Date;
  }>(sql`
    select s.id, s.deck_id, s.label, s.format,
           coalesce((select sum((e->>'quantity')::int)
                       from jsonb_array_elements(s.entries) e), 0)::int as card_count,
           s.created_at
      from deck_snapshots s
     where s.deck_id = ${deckId}
     order by s.created_at desc, s.id desc
  `);

  return rows.rows.map((row) => ({
    id: SnapshotId.of(Number(row.id)),
    deckId: DeckId.of(Number(row.deck_id)),
    label: row.label,
    format: z.enum(FORMATS).parse(row.format),
    cardCount: row.card_count,
    createdAt: new Date(row.created_at),
  }));
}

async function loadSnapshotsById(
  db: DbExecutor,
  deckId: number,
  ids: readonly number[],
): Promise<Map<number, StoredSnapshot>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(deckSnapshots)
    .where(and(eq(deckSnapshots.deckId, deckId), inArray(deckSnapshots.id, unique)))
    .orderBy(desc(deckSnapshots.createdAt));

  return new Map(
    rows.map((row) => {
      const format = z.enum(FORMATS).parse(row.format);
      return [
        row.id,
        {
          id: row.id,
          label: row.label,
          format,
          targetBracket:
            row.targetBracket !== null && isBracket(row.targetBracket) ? row.targetBracket : null,
          entries: z.array(StoredSnapshotEntrySchema).parse(row.entries),
          createdAt: new Date(row.createdAt),
        },
      ];
    }),
  );
}

/**
 * Compares a saved snapshot ("before") against either another saved snapshot or the live deck
 * ("after", the default), reusing `preview.ts` card loading and comparison logic.
 */
export async function compareDeckSnapshot(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  beforeSnapshotId: number,
  afterSnapshotId?: number,
): Promise<SnapshotComparison | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;

  const wantedIds =
    afterSnapshotId !== undefined ? [beforeSnapshotId, afterSnapshotId] : [beforeSnapshotId];
  const snapshots = await loadSnapshotsById(db, deckId, wantedIds);
  const beforeSnap = snapshots.get(beforeSnapshotId);
  if (beforeSnap === undefined) return null;
  const afterSnap = afterSnapshotId !== undefined ? snapshots.get(afterSnapshotId) : undefined;
  if (afterSnapshotId !== undefined && afterSnap === undefined) return null;

  const known = new Map<string, PreviewLine>();
  for (const line of view.lines) {
    if (!known.has(line.oracleId)) {
      known.set(line.oracleId, lineToPreview(line, view.rules[line.oracleId]));
    }
  }
  const missingIds = [
    ...beforeSnap.entries.map((entry) => entry.oracleId),
    ...(afterSnap?.entries.map((entry) => entry.oracleId) ?? []),
  ].filter((oracleId) => !known.has(oracleId));
  const extra = await loadCardsForPreview(db, userId, view.deck.usesRealCards, missingIds);
  for (const [oracleId, card] of extra) known.set(oracleId, card);

  const toLines = (entries: readonly z.infer<typeof StoredSnapshotEntrySchema>[]): PreviewLine[] =>
    entries.flatMap((entry) => {
      const base = known.get(entry.oracleId);
      return base === undefined ? [] : [{ ...base, board: entry.board, quantity: entry.quantity }];
    });

  const beforeLines = toLines(beforeSnap.entries);
  const afterLines =
    afterSnap !== undefined
      ? toLines(afterSnap.entries)
      : view.lines.map((line) => lineToPreview(line, view.rules[line.oracleId]));
  const format = afterSnap !== undefined ? afterSnap.format : view.deck.format;
  const targetBracket = afterSnap !== undefined ? afterSnap.targetBracket : view.deck.targetBracket;

  const comparison = compareDeckStates({
    format,
    targetBracket,
    before: beforeLines,
    after: afterLines,
  });

  const scoreBefore = scoreDeck(
    beforeLines.filter((line) => isPlayed(line.board)).map(previewLineToOptimizerCard),
    { format: beforeSnap.format, targetBracket: beforeSnap.targetBracket },
  );
  const scoreAfter = scoreDeck(
    afterLines.filter((line) => isPlayed(line.board)).map(previewLineToOptimizerCard),
    { format, targetBracket },
  );

  return {
    ...comparison,
    deck: { id: Number(view.deck.id), name: view.deck.name, format: view.deck.format },
    fingerprint: viewFingerprint(view),
    beforeSide: {
      snapshotId: beforeSnap.id,
      label: beforeSnap.label,
      format: beforeSnap.format,
      createdAt: beforeSnap.createdAt.toISOString(),
    },
    afterSide:
      afterSnap !== undefined
        ? {
            snapshotId: afterSnap.id,
            label: afterSnap.label,
            format: afterSnap.format,
            createdAt: afterSnap.createdAt.toISOString(),
          }
        : {
            snapshotId: null,
            label: "Current deck",
            format: view.deck.format,
            createdAt: null,
          },
    scoreBefore,
    scoreAfter,
    scoreDelta: Number((scoreAfter.total - scoreBefore.total).toFixed(2)),
  };
}
