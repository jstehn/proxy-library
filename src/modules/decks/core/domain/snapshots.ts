import { err, ok, type Brand, type Result } from "@/shared/kernel";
import type { Bracket } from "./brackets";
import type { DeckEntry, DeckId, Format, Grouping } from "./deck";
import type { SnapshotLabelInvalid } from "./errors";

// Immutable point-in-time snapshots of a deck for comparing before/after cuts (design doc 41).

export type SnapshotId = Brand<number, "SnapshotId">;
export const SnapshotId = {
  of(raw: number): SnapshotId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a snapshot id: ${raw}`);
    return raw as SnapshotId;
  },
};

export const MAX_SNAPSHOT_LABEL_LENGTH = 60;
export const MAX_SNAPSHOTS_PER_DECK = 30;

/** Validates and normalizes a snapshot label (1..60 trimmed single-line characters). */
export function checkSnapshotLabel(raw: string): Result<string, SnapshotLabelInvalid> {
  const label = raw.trim().replace(/\s+/g, " ");
  if (label.length === 0 || label.length > MAX_SNAPSHOT_LABEL_LENGTH) {
    return err({ kind: "SnapshotLabelInvalid", maximum: MAX_SNAPSHOT_LABEL_LENGTH });
  }
  return ok(label);
}

/** One line saved in a snapshot: identical to `DeckEntry`. */
export type SnapshotEntry = DeckEntry;

export type DeckSnapshot = Readonly<{
  id: SnapshotId;
  deckId: DeckId;
  label: string;
  format: Format;
  targetBracket: Bracket | null;
  grouping: Grouping;
  headings: readonly string[];
  entries: readonly SnapshotEntry[];
  createdAt: Date;
}>;

export type SnapshotSummary = Readonly<{
  id: SnapshotId;
  deckId: DeckId;
  label: string;
  format: Format;
  cardCount: number;
  createdAt: Date;
}>;
