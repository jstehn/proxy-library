import type { Board, DeckId } from "@/modules/decks/core/client";
import type { DeckSnapshot, SnapshotId } from "../domain/snapshots";
import type { DecksServices } from "@/modules/decks/core";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";

// Ports of the changes area: what saving snapshots and keeping previews need from outside.

/** Saved point-in-time copies of a deck (design doc 41). */
export interface SnapshotRepository {
  /** How many saved snapshots this deck has. */
  countSnapshots(deckId: DeckId): Promise<number>;
  /** Saves a point-in-time snapshot of a deck and returns its new id. */
  saveSnapshot(snapshot: Omit<DeckSnapshot, "id">): Promise<SnapshotId>;
  /** One saved snapshot belonging to this deck, or null if absent. */
  getSnapshot(deckId: DeckId, snapshotId: SnapshotId): Promise<DeckSnapshot | null>;
  /** Deletes a snapshot belonging to this deck; returns false if it wasn't there. */
  deleteSnapshot(deckId: DeckId, snapshotId: SnapshotId): Promise<boolean>;
}

export type SnapshotServices = DecksServices & { snapshots: SnapshotRepository };

export type SnapshotDependencies = { unitOfWork: UnitOfWork<SnapshotServices>; clock: Clock };

/** One change of a stored preview, resolved to the card's oracle id (design doc 40). */
export type ChangeToSave = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  note?: string | null;
  heading?: string | null;
  tags?: readonly string[];
  role?: string | null;
  pinned?: boolean;
}>;

export type PreviewRecord = Readonly<{
  id: string;
  userId: UserId;
  deckId: number;
  /** The deck's fingerprint when the preview was made: applying needs the deck to match. */
  fingerprint: string;
  changes: readonly ChangeToSave[];
  expiresAt: Date;
}>;

/** Dry-run changes kept until they're applied or expire (so they survive a restart). */
export interface PreviewRepository {
  store(record: PreviewRecord): Promise<void>;
  /** The player's own preview, if it hasn't expired. */
  find(id: string, userId: UserId, now: Date): Promise<PreviewRecord | null>;
  delete(id: string): Promise<void>;
  /** Removes every preview that expired before `now`. */
  prune(now: Date): Promise<void>;
}
