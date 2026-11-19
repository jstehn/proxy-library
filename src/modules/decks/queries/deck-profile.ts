import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { EMPTY_DECK_PROFILE, patchPrimerSection, type DeckPlan } from "../domain/deck-profile";
import { decks } from "../infrastructure/schema";

export interface StoredDeckProfile {
  deckId: number;
  deckName: string;
  format: string;
  profile: DeckPlan;
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
  patch: Partial<DeckPlan>,
  now: Date,
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

  const merged: DeckPlan = {
    ...EMPTY_DECK_PROFILE,
    ...(row.profileJson ?? {}),
    ...patch,
  };

  await db.update(decks).set({ profileJson: merged, updatedAt: now }).where(eq(decks.id, deckId));

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
  now: Date,
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

  await db.update(decks).set({ primer: nextPrimer, updatedAt: now }).where(eq(decks.id, deckId));

  return { deckId: row.id, primer: nextPrimer };
}
