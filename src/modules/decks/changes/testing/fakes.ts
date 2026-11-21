import type { DeckId } from "@/modules/decks/core/client";
import { SnapshotId, type DeckSnapshot } from "../domain/snapshots";
import type { SnapshotRepository } from "../application/ports";

// In-memory stand-in for the snapshot port.

export function inMemorySnapshotRepository() {
  const snapshots = new Map<SnapshotId, DeckSnapshot>();
  let lastSnapshotId = 0;

  const repository: SnapshotRepository = {
    async countSnapshots(deckId) {
      return [...snapshots.values()].filter((snapshot) => snapshot.deckId === deckId).length;
    },
    async saveSnapshot(snapshot) {
      const id = SnapshotId.of(++lastSnapshotId);
      snapshots.set(id, { id, ...snapshot });
      return id;
    },
    async getSnapshot(deckId, snapshotId) {
      const found = snapshots.get(snapshotId);
      return found !== undefined && found.deckId === deckId ? found : null;
    },
    async deleteSnapshot(deckId, snapshotId) {
      const found = snapshots.get(snapshotId);
      if (found === undefined || found.deckId !== deckId) return false;
      snapshots.delete(snapshotId);
      return true;
    },
  };
  return {
    ...repository,
    snapshotsOf: (deckId: DeckId) =>
      [...snapshots.values()].filter((snapshot) => snapshot.deckId === deckId),
  };
}
