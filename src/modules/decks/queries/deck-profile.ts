import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import {
  EMPTY_DECK_PROFILE,
  patchPrimerSection,
  type DeckProfile,
} from "../domain/deck-profile";
import { deckEntries, decks } from "../infrastructure/schema";

export interface StoredDeckProfile {
  deckId: number;
  deckName: string;
  format: string;
  profile: DeckProfile;
  primer: string | null;
}

export async function getDeckProfile(
  db: DbExecutor,
  viewerId: string,
  deckId: number,
): Promise<StoredDeckProfile | null> {
  const [row] = await db
    .select({
      id: decks.id,
      name: decks.name,
      format: decks.format,
      ownerId: decks.ownerId,
      visibility: decks.visibility,
      profileJson: decks.profileJson,
      primer: decks.primer,
    })
    .from(decks)
    .where(eq(decks.id, deckId))
    .limit(1);

  if (!row) return null;
  if (row.ownerId !== viewerId && row.visibility !== "shared") return null;

  return {
    deckId: row.id,
    deckName: row.name,
    format: row.format,
    profile: {
      ...EMPTY_DECK_PROFILE,
      ...(row.profileJson ?? {}),
    },
    primer: row.primer ?? null,
  };
}

export async function updateDeckProfile(
  db: DbExecutor,
  ownerId: string,
  deckId: number,
  patch: Partial<DeckProfile>,
): Promise<StoredDeckProfile | null> {
  const [row] = await db
    .select({
      id: decks.id,
      name: decks.name,
      format: decks.format,
      ownerId: decks.ownerId,
      profileJson: decks.profileJson,
      primer: decks.primer,
    })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerId, ownerId)))
    .limit(1);

  if (!row) return null;

  const merged: DeckProfile = {
    ...EMPTY_DECK_PROFILE,
    ...(row.profileJson ?? {}),
    ...patch,
  };

  await db
    .update(decks)
    .set({ profileJson: merged, updatedAt: new Date() })
    .where(eq(decks.id, deckId));

  return {
    deckId: row.id,
    deckName: row.name,
    format: row.format,
    profile: merged,
    primer: row.primer ?? null,
  };
}

export async function updateDeckPrimer(
  db: DbExecutor,
  ownerId: string,
  deckId: number,
  input: { section?: string; content: string },
): Promise<{ deckId: number; primer: string } | null> {
  const [row] = await db
    .select({ id: decks.id, primer: decks.primer })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerId, ownerId)))
    .limit(1);

  if (!row) return null;

  const nextPrimer = input.section
    ? patchPrimerSection(row.primer, input.section, input.content)
    : input.content.trim();

  await db
    .update(decks)
    .set({ primer: nextPrimer, updatedAt: new Date() })
    .where(eq(decks.id, deckId));

  return { deckId: row.id, primer: nextPrimer };
}

export async function updateDeckEntryMetadata(
  db: DbExecutor,
  ownerId: string,
  deckId: number,
  oracleId: string,
  board: string,
  patch: { tags?: string[]; role?: string | null; pinned?: boolean },
): Promise<boolean> {
  const [deckRow] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerId, ownerId)))
    .limit(1);
  if (!deckRow) return false;

  const updates: Record<string, unknown> = {};
  if (patch.tags !== undefined) updates.tags = patch.tags;
  if (patch.role !== undefined) updates.role = patch.role;
  if (patch.pinned !== undefined) updates.pinned = patch.pinned;
  if (Object.keys(updates).length === 0) return true;

  await db
    .update(deckEntries)
    .set(updates)
    .where(
      and(
        eq(deckEntries.deckId, deckId),
        eq(deckEntries.oracleId, oracleId),
        eq(deckEntries.board, board),
      ),
    );
  await db.update(decks).set({ updatedAt: sql`now()` }).where(eq(decks.id, deckId));
  return true;
}
