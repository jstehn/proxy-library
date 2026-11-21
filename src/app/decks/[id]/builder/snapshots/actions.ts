"use server";
import { z } from "zod";
import { DeckId, describeDeckError, SnapshotId } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { err, ok } from "@/shared/kernel";
import { DeckIdInput, loadDeck, NOT_YOURS } from "../action-helpers";
import { rejected } from "../answer";
import { revalidateDeck } from "@/app/decks/paths";

// The builder's snapshots (design doc 41).

/** Lists saved snapshots for a deck, newest first (design doc 41). */
export const listSnapshotsAction = action(DeckIdInput, async ({ actor, reads }, deckId) => {
  const snapshots = await reads.decks.snapshots(actor, deckId);
  return snapshots === null ? err(rejected(NOT_YOURS)) : ok(snapshots);
});

const SaveSnapshotInput = z.object({
  deckId: DeckIdInput,
  label: z.string().max(120),
});

/** Saves a snapshot of the deck's current entries (design doc 41). */
export const saveSnapshotAction = action(
  SaveSnapshotInput,
  async ({ actor, capabilities, reads }, input) => {
    const result = await capabilities.deckEdits.saveSnapshot(actor, {
      deckId: DeckId.of(input.deckId),
      label: input.label,
    });
    if (!result.ok) return err(rejected(describeDeckError(result.error)));
    const snapshots = await reads.decks.snapshots(actor, input.deckId);
    return ok({ snapshotId: result.value, snapshots: snapshots ?? [] });
  },
);

const CompareSnapshotInput = z.object({
  deckId: DeckIdInput,
  beforeSnapshotId: z.number().int().positive(),
  afterSnapshotId: z.number().int().positive().nullable().optional(),
});

/** Compares a saved snapshot against the live deck or another snapshot (design doc 41). */
export const compareSnapshotAction = action(
  CompareSnapshotInput,
  async ({ actor, reads }, input) => {
    const comparison = await reads.decks.compareSnapshots(
      actor,
      input.deckId,
      input.beforeSnapshotId,
      input.afterSnapshotId ?? undefined,
    );
    return comparison === null
      ? err(rejected("That snapshot isn't available anymore."))
      : ok(comparison);
  },
);

const SnapshotMutationInput = z.object({
  deckId: DeckIdInput,
  snapshotId: z.number().int().positive(),
});

/** Restores a deck's entries to a saved snapshot (design doc 41). */
export const restoreSnapshotAction = action(SnapshotMutationInput, async (context, input) => {
  const result = await context.capabilities.deckEdits.restoreSnapshot(context.actor, {
    deckId: DeckId.of(input.deckId),
    snapshotId: SnapshotId.of(input.snapshotId),
  });
  if (!result.ok) return err(rejected(describeDeckError(result.error)));
  revalidateDeck(input.deckId);
  const deck = await loadDeck(context, input.deckId);
  return deck === null ? err(rejected(NOT_YOURS)) : ok({ deck, cardCount: result.value.cards });
});

/** Deletes a saved snapshot without changing the deck (design doc 41). */
export const deleteSnapshotAction = action(
  SnapshotMutationInput,
  async ({ actor, capabilities, reads }, input) => {
    const result = await capabilities.deckEdits.deleteSnapshot(actor, {
      deckId: DeckId.of(input.deckId),
      snapshotId: SnapshotId.of(input.snapshotId),
    });
    if (!result.ok) return err(rejected(describeDeckError(result.error)));
    const snapshots = await reads.decks.snapshots(actor, input.deckId);
    return snapshots === null ? err(rejected(NOT_YOURS)) : ok(snapshots);
  },
);
