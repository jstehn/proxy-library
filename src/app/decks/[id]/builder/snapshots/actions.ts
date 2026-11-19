"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type SnapshotComparison,
  type SnapshotSummary,
  DeckId,
  describeDeckError,
  SnapshotId,
} from "@/modules/decks";

import {
  builderAction,
  DeckIdInput,
  NOT_YOURS,
  fail,
  loadDeck,
  type BuilderDeck,
} from "../action-helpers";

// The builder's snapshots (design doc 41).

export type SnapshotsListResult =
  { ok: true; snapshots: SnapshotSummary[] } | { ok: false; message: string };

const listSnapshots = builderAction<typeof DeckIdInput, SnapshotsListResult>(
  DeckIdInput,
  fail("That deck wasn't recognized."),
  async ({ actor, capabilities }, deckId) => {
    const snapshots = await capabilities.deckReads.snapshots(actor.userId, deckId);
    return snapshots === null ? fail(NOT_YOURS) : { ok: true, snapshots };
  },
);

/** Lists saved snapshots for a deck, newest first (design doc 41). */
export async function listSnapshotsAction(deckId: number): Promise<SnapshotsListResult> {
  return listSnapshots(deckId);
}

const SaveSnapshotInput = z.object({
  deckId: DeckIdInput,
  label: z.string().max(120),
});

export type SaveSnapshotResult =
  { ok: true; snapshotId: number; snapshots: SnapshotSummary[] } | { ok: false; message: string };

/** Saves a snapshot of the deck's current entries (design doc 41). */
export const saveSnapshotAction = builderAction<typeof SaveSnapshotInput, SaveSnapshotResult>(
  SaveSnapshotInput,
  fail("That snapshot label wasn't understood."),
  async ({ actor, capabilities }, input) => {
    const result = await capabilities.deckEdits.saveSnapshot(actor, {
      deckId: DeckId.of(input.deckId),
      label: input.label,
    });
    if (!result.ok) return fail(describeDeckError(result.error));
    const snapshots = await capabilities.deckReads.snapshots(actor.userId, input.deckId);
    return { ok: true, snapshotId: result.value, snapshots: snapshots ?? [] };
  },
);

const CompareSnapshotInput = z.object({
  deckId: DeckIdInput,
  beforeSnapshotId: z.number().int().positive(),
  afterSnapshotId: z.number().int().positive().nullable().optional(),
});

export type CompareSnapshotResult =
  { ok: true; comparison: SnapshotComparison } | { ok: false; message: string };

/** Compares a saved snapshot against the live deck or another snapshot (design doc 41). */
export const compareSnapshotAction = builderAction<
  typeof CompareSnapshotInput,
  CompareSnapshotResult
>(
  CompareSnapshotInput,
  fail("Couldn't compare those snapshots."),
  async ({ actor, capabilities }, input) => {
    const comparison = await capabilities.deckReads.compareSnapshots(
      actor.userId,
      input.deckId,
      input.beforeSnapshotId,
      input.afterSnapshotId ?? undefined,
    );
    return comparison === null
      ? fail("That snapshot isn't available anymore.")
      : { ok: true, comparison };
  },
);

const SnapshotMutationInput = z.object({
  deckId: DeckIdInput,
  snapshotId: z.number().int().positive(),
});

export type RestoreSnapshotResult =
  { ok: true; deck: BuilderDeck; cardCount: number } | { ok: false; message: string };

/** Restores a deck's entries to a saved snapshot (design doc 41). */
export const restoreSnapshotAction = builderAction<
  typeof SnapshotMutationInput,
  RestoreSnapshotResult
>(SnapshotMutationInput, fail("That snapshot wasn't understood."), async (context, input) => {
  const result = await context.capabilities.deckEdits.restoreSnapshot(context.actor, {
    deckId: DeckId.of(input.deckId),
    snapshotId: SnapshotId.of(input.snapshotId),
  });
  if (!result.ok) return fail(describeDeckError(result.error));
  revalidatePath(`/decks/${input.deckId}`);
  const deck = await loadDeck(context, input.deckId);
  return deck === null ? fail(NOT_YOURS) : { ok: true, deck, cardCount: result.value.cards };
});

/** Deletes a saved snapshot without changing the deck (design doc 41). */
export const deleteSnapshotAction = builderAction<
  typeof SnapshotMutationInput,
  SnapshotsListResult
>(
  SnapshotMutationInput,
  fail("That snapshot wasn't understood."),
  async ({ actor, capabilities }, input) => {
    const result = await capabilities.deckEdits.deleteSnapshot(actor, {
      deckId: DeckId.of(input.deckId),
      snapshotId: SnapshotId.of(input.snapshotId),
    });
    if (!result.ok) return fail(describeDeckError(result.error));
    const snapshots = await capabilities.deckReads.snapshots(actor.userId, input.deckId);
    return snapshots === null ? fail(NOT_YOURS) : { ok: true, snapshots };
  },
);
