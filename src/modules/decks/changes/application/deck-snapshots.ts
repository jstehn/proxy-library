// Saved point-in-time copies of a deck (design doc 41). Every use case works only on the actor's own decks (rule 7): someone else's deck is
// reported as not found.

import { formatRules } from "@/modules/decks/core/client";
import type { Actor } from "@/modules/accounts";
import { type Result, err, ok } from "@/shared/kernel";
import { type DeckId } from "@/modules/decks/core/client";
import { tidyHeadings } from "@/modules/decks/core/client";
import { checkSnapshotLabel, MAX_SNAPSHOTS_PER_DECK, type SnapshotId } from "../domain/snapshots";
import type {
  DeckChanged,
  DeckNotFound,
  SnapshotLabelInvalid,
  SnapshotNotFound,
  TooManySnapshots,
} from "@/modules/decks/core/client";
import { fingerprint } from "@/modules/decks/core/client";
import type { SnapshotDependencies } from "./ports";
import type { ApplyChangesReport } from "@/modules/decks/core";

export type SaveSnapshotError = DeckNotFound | SnapshotLabelInvalid | TooManySnapshots;

export type RestoreSnapshotError = DeckNotFound | SnapshotNotFound | DeckChanged;

export type DeleteSnapshotError = DeckNotFound | SnapshotNotFound;

export type DeckSnapshots = ReturnType<typeof makeDeckSnapshots>;

export function makeDeckSnapshots(dependencies: SnapshotDependencies) {
  const { unitOfWork, clock } = dependencies;

  /** Saves a point-in-time snapshot of a deck for before/after comparisons (design doc 41). */
  async function saveSnapshot(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; label: string }>,
  ): Promise<Result<SnapshotId, SaveSnapshotError>> {
    const label = checkSnapshotLabel(input.label);
    if (!label.ok) return label;
    return unitOfWork.run<SnapshotId, SaveSnapshotError>(async ({ decks, snapshots }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      if ((await snapshots.countSnapshots(deck.id)) >= MAX_SNAPSHOTS_PER_DECK) {
        return err({ kind: "TooManySnapshots", maximum: MAX_SNAPSHOTS_PER_DECK });
      }
      return ok(
        await snapshots.saveSnapshot({
          deckId: deck.id,
          label: label.value,
          format: deck.format,
          targetBracket: deck.targetBracket,
          grouping: deck.grouping,
          headings: [...deck.headings],
          entries: deck.entries.map((entry) => ({ ...entry })),
          createdAt: clock.now(),
        }),
      );
    });
  }

  /** Restores a deck's entries, format, target bracket, and headings from a saved snapshot. */
  async function restoreSnapshot(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; snapshotId: SnapshotId; fingerprint?: string }>,
  ): Promise<Result<ApplyChangesReport, RestoreSnapshotError>> {
    return unitOfWork.run<ApplyChangesReport, RestoreSnapshotError>(
      async ({ decks, cards, snapshots }) => {
        const deck = await decks.lockOwned(input.deckId, actor.userId);
        if (deck === null) return err({ kind: "DeckNotFound" });
        if (input.fingerprint !== undefined && fingerprint(deck.entries) !== input.fingerprint) {
          return err({ kind: "DeckChanged" });
        }
        const snapshot = await snapshots.getSnapshot(deck.id, input.snapshotId);
        if (snapshot === null) return err({ kind: "SnapshotNotFound" });

        const knownOracles = await cards.existingOracleIds(
          snapshot.entries.map((entry) => entry.oracleId),
        );
        const pinnedPrintings = snapshot.entries.flatMap((entry) =>
          entry.printingId === null ? [] : [entry.printingId],
        );
        const knownPrintings = await cards.existingPrintings(pinnedPrintings);

        const restoredEntries = snapshot.entries
          .filter((entry) => knownOracles.has(entry.oracleId))
          .map((entry) => {
            const keepsPrinting = entry.printingId !== null && knownPrintings.has(entry.printingId);
            return {
              ...entry,
              printingId: keepsPrinting ? entry.printingId : null,
              finish: keepsPrinting ? entry.finish : null,
            };
          });

        const restored = tidyHeadings({
          ...deck,
          format: snapshot.format,
          targetBracket: formatRules(snapshot.format).bracketsApply ? snapshot.targetBracket : null,
          grouping: snapshot.grouping,
          headings: [...snapshot.headings],
          entries: restoredEntries,
        });
        await decks.save(restored, clock.now());
        return ok({
          cards: restored.entries.reduce((total, entry) => total + entry.quantity, 0),
          fingerprint: fingerprint(restored.entries),
        });
      },
    );
  }

  /** Deletes one saved snapshot belonging to the deck. */
  async function deleteSnapshot(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; snapshotId: SnapshotId }>,
  ): Promise<Result<void, DeleteSnapshotError>> {
    return unitOfWork.run<void, DeleteSnapshotError>(async ({ decks, snapshots }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const deleted = await snapshots.deleteSnapshot(deck.id, input.snapshotId);
      if (!deleted) return err({ kind: "SnapshotNotFound" });
      return ok();
    });
  }

  return {
    saveSnapshot,
    restoreSnapshot,
    deleteSnapshot,
  };
}
