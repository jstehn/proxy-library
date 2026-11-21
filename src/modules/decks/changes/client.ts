// The pure code of decks/changes that the other areas, the module root and the browser use (ADR 0016, 0029).
export { copiesToTake } from "./domain/free-copies";
export { compareDeckStates, type ChangePreview, type PreviewLine } from "./domain/preview";
export {
  MAX_SNAPSHOTS_PER_DECK,
  MAX_SNAPSHOT_LABEL_LENGTH,
  SnapshotId,
  checkSnapshotLabel,
  type SnapshotSummary,
} from "./domain/snapshots";
