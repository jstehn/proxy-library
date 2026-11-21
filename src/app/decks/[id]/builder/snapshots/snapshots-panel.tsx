"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Board, SnapshotComparison, SnapshotSummary } from "@/modules/decks";
import {
  checkSnapshotLabel,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
} from "@/modules/decks/client";
import { estimateLabel, problemText, TAG_LABELS } from "@/app/decks/labels";
import {
  compareSnapshotAction,
  deleteSnapshotAction,
  listSnapshotsAction,
  restoreSnapshotAction,
  saveSnapshotAction,
} from "./actions";
import { settle } from "../answer";
import { type BuilderDeck } from "../builder-deck";
import { ConfirmButton } from "@/ui/confirm-button";

const SNAPSHOT_BUTTON = "text-[11px]";

const BOARD_NAMES: Readonly<Record<Board, string>> = {
  main: "Main",
  side: "Sideboard",
  maybe: "Maybeboard",
  commander: "Commander",
};

function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Saved points in the deck's history: save a snapshot, compare before/after cuts, or restore one
 * (design doc 41).
 */
export function SnapshotsPanel(props: {
  deckId: number;
  deckKey: string;
  busy: boolean;
  onRestored: (deck: BuilderDeck, message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const { deckId, deckKey, onError, onRestored } = props;
  const labelId = useId();
  const labelErrorId = useId();
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [afterId, setAfterId] = useState<number | null>(null);
  const [comparison, setComparison] = useState<SnapshotComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const latestCompare = useRef(0);

  // Load snapshots when opening the panel.
  useEffect(() => {
    let cancelled = false;
    void listSnapshotsAction(deckId).then((answer) => {
      if (cancelled) return;
      const result = settle(answer, "That deck wasn't recognized.");
      if (result.ok) {
        setSnapshots(result.value);
        setLoadError(null);
      } else {
        setLoadError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  // Refresh a comparison against the live deck whenever the deck itself changes.
  useEffect(() => {
    if (beforeId === null || afterId !== null) return;
    const request = ++latestCompare.current;
    void compareSnapshotAction({ deckId, beforeSnapshotId: beforeId, afterSnapshotId: null }).then(
      (answer) => {
        if (request !== latestCompare.current) return;
        const result = settle(answer, "Couldn't compare those snapshots.");
        if (result.ok) setComparison(result.value);
      },
    );
  }, [deckId, deckKey, beforeId, afterId]);

  async function runCompare(nextBeforeId: number, nextAfterId: number | null) {
    setBeforeId(nextBeforeId);
    setAfterId(nextAfterId);
    setComparing(true);
    const request = ++latestCompare.current;
    const result = settle(
      await compareSnapshotAction({
        deckId,
        beforeSnapshotId: nextBeforeId,
        afterSnapshotId: nextAfterId,
      }),
      "Couldn't compare those snapshots.",
    );
    if (request !== latestCompare.current) return;
    setComparing(false);
    if (result.ok) {
      setComparison(result.value);
    } else {
      onError(result.error.message);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkSnapshotLabel(label);
    if (!checked.ok) {
      setLabelError(`Give the snapshot a label (1 to ${MAX_SNAPSHOT_LABEL_LENGTH} characters).`);
      return;
    }
    setLabelError(null);
    setWorking(true);
    const result = settle(
      await saveSnapshotAction({ deckId, label: checked.value }),
      "That snapshot label wasn't understood.",
    );
    setWorking(false);
    if (!result.ok) {
      setLabelError(result.error.message);
      onError(result.error.message);
      return;
    }
    setSnapshots(result.value.snapshots);
    setLabel("");
    setStatusMessage(`Saved snapshot “${checked.value}”.`);
  }

  async function restore(snapshot: SnapshotSummary) {
    setWorking(true);
    const result = settle(
      await restoreSnapshotAction({ deckId, snapshotId: snapshot.id }),
      "That snapshot wasn't understood.",
    );
    setWorking(false);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    const { cardCount, deck } = result.value;
    const msg = `Restored “${snapshot.label}” (${cardCount} ${cardCount === 1 ? "card" : "cards"}).`;
    setStatusMessage(msg);
    onRestored(deck, msg);
  }

  async function remove(snapshot: SnapshotSummary) {
    setWorking(true);
    const result = settle(
      await deleteSnapshotAction({ deckId, snapshotId: snapshot.id }),
      "That snapshot wasn't understood.",
    );
    setWorking(false);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setSnapshots(result.value);
    if (beforeId === Number(snapshot.id) || afterId === Number(snapshot.id)) {
      setBeforeId(null);
      setAfterId(null);
      setComparison(null);
    }
    setStatusMessage(`Deleted snapshot “${snapshot.label}”.`);
  }

  const busy = working || props.busy;
  const atLimit = snapshots !== null && snapshots.length >= MAX_SNAPSHOTS_PER_DECK;

  return (
    <section
      aria-label="Deck snapshots"
      className="border-border-subtle flex flex-col gap-3 rounded-md border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium">Snapshots</h3>
          {snapshots !== null && (
            <span className="text-muted text-xs">
              {snapshots.length}/{MAX_SNAPSHOTS_PER_DECK}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="text-muted hover:text-foreground text-xs"
        >
          Close
        </button>
      </div>

      <form onSubmit={save} className="flex flex-col gap-1.5">
        <label htmlFor={labelId} className="text-muted text-xs">
          Save a snapshot before making cuts
        </label>
        <div className="flex gap-1.5">
          <input
            id={labelId}
            name="snapshotLabel"
            type="text"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              if (labelError !== null) setLabelError(null);
            }}
            placeholder="e.g. Before cutting ramp"
            maxLength={MAX_SNAPSHOT_LABEL_LENGTH}
            aria-invalid={labelError !== null ? "true" : "false"}
            aria-describedby={labelError !== null ? labelErrorId : undefined}
            disabled={busy || atLimit}
            className="border-line min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy || atLimit}
            className="border-line rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          >
            Save
          </button>
        </div>
        {labelError !== null && (
          <p id={labelErrorId} role="status" className="text-danger-text text-xs">
            {labelError}
          </p>
        )}
        {atLimit && (
          <p className="text-warning-text text-xs">
            Limit of {MAX_SNAPSHOTS_PER_DECK} snapshots reached. Delete an older one to save more.
          </p>
        )}
      </form>

      {statusMessage !== null && (
        <p role="status" className="text-muted text-xs">
          {statusMessage}
        </p>
      )}

      {loadError !== null ? (
        <p className="text-danger-text text-xs">{loadError}</p>
      ) : snapshots === null ? (
        <p className="text-muted text-xs">Loading snapshots…</p>
      ) : snapshots.length === 0 ? (
        <p className="text-muted text-xs">
          No snapshots saved yet. Save one to compare before and after edits.
        </p>
      ) : (
        <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-xs">
          {snapshots.map((snapshot) => {
            const snapshotId = Number(snapshot.id);
            const isComparing = beforeId === snapshotId;
            return (
              <li
                key={snapshotId}
                className={`flex flex-col gap-1 rounded border p-2 ${
                  isComparing
                    ? "border-sky-400 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/30"
                    : "border-border-subtle"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium" title={snapshot.label}>
                    {snapshot.label}
                  </span>
                  <span className="text-muted shrink-0 tabular-nums">
                    {snapshot.cardCount} {snapshot.cardCount === 1 ? "card" : "cards"}
                  </span>
                </div>
                <div className="text-muted flex flex-wrap items-center justify-between gap-2">
                  <span>{formatTimestamp(snapshot.createdAt)}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy || comparing}
                      onClick={() => void runCompare(snapshotId, null)}
                      className="border-line text-muted hover:bg-surface rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                    >
                      {isComparing ? "Comparing" : "Compare"}
                    </button>
                    <ConfirmButton
                      variant="secondary"
                      size="mini"
                      disabled={busy}
                      className={SNAPSHOT_BUTTON}
                      question={`Restore “${snapshot.label}”? The deck goes back to that snapshot.`}
                      confirmLabel="Restore"
                      onConfirm={() => void restore(snapshot)}
                    >
                      Restore
                    </ConfirmButton>
                    <ConfirmButton
                      variant="secondary"
                      size="mini"
                      disabled={busy}
                      className={SNAPSHOT_BUTTON}
                      question={`Delete the snapshot “${snapshot.label}”? This can't be undone.`}
                      confirmLabel="Delete"
                      onConfirm={() => void remove(snapshot)}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {comparison !== null && snapshots !== null && (
        <div
          aria-live="polite"
          className="border-border-subtle bg-surface flex flex-col gap-2 rounded border p-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {comparison.beforeSide.label} → {comparison.afterSide.label}
            </span>
            <button
              type="button"
              onClick={() => {
                setBeforeId(null);
                setAfterId(null);
                setComparison(null);
              }}
              className="text-muted hover:text-foreground"
            >
              Hide diff
            </button>
          </div>
          {snapshots.length > 1 && beforeId !== null && (
            <label className="text-muted flex items-center gap-2">
              <span>Compare against:</span>
              <select
                value={afterId ?? ""}
                disabled={comparing}
                onChange={(event) => {
                  const next = event.target.value;
                  void runCompare(beforeId, next === "" ? null : Number(next));
                }}
                className="border-line text-foreground min-w-0 flex-1 rounded border bg-transparent px-1.5 py-0.5 text-xs"
              >
                <option value="">Current deck</option>
                {snapshots
                  .filter((each) => Number(each.id) !== beforeId)
                  .map((each) => (
                    <option key={Number(each.id)} value={Number(each.id)}>
                      {each.label}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <span className="text-muted">Cards</span>
              <p className="font-medium tabular-nums">
                {comparison.before.stats.cardCount} → {comparison.after.stats.cardCount}
              </p>
            </div>
            <div>
              <span className="text-muted">Avg. mana value</span>
              <p className="font-medium tabular-nums">
                {comparison.before.stats.averageManaValue.toFixed(2)} →{" "}
                {comparison.after.stats.averageManaValue.toFixed(2)}
              </p>
            </div>
            {comparison.bracket.before !== null && comparison.bracket.after !== null && (
              <div>
                <span className="text-muted">Bracket</span>
                <p className="font-medium tabular-nums">
                  {estimateLabel(comparison.bracket.before)} →{" "}
                  {estimateLabel(comparison.bracket.after)}
                </p>
              </div>
            )}
          </div>

          {comparison.roles.length > 0 && (
            <div className="text-muted flex flex-wrap gap-x-3 gap-y-1">
              {comparison.roles.map((role) => (
                <span key={role.tag}>
                  {TAG_LABELS[role.tag]}: {role.before} → {role.after}
                </span>
              ))}
            </div>
          )}

          {comparison.changes.length === 0 ? (
            <p className="text-muted">No card changes between these two lists.</p>
          ) : (
            <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
              {comparison.changes.map((change) => {
                const delta = change.afterQuantity - change.beforeQuantity;
                return (
                  <li
                    key={`${change.board}:${change.oracleId}`}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="min-w-0 truncate">
                      <span
                        className={
                          delta > 0
                            ? "text-success-text mr-1 font-semibold"
                            : "text-danger-text mr-1 font-semibold"
                        }
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                      {change.name}{" "}
                      <span className="text-muted">({BOARD_NAMES[change.board]})</span>
                    </span>
                    <span className="text-muted shrink-0 tabular-nums">
                      {change.beforeQuantity} → {change.afterQuantity}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {comparison.problems.added.length > 0 && (
            <div className="text-danger-text">
              <p className="font-medium">New problems:</p>
              <ul className="list-disc pl-4">
                {comparison.problems.added.map((problem) => {
                  const text = problemText(problem);
                  return <li key={text}>{text}</li>;
                })}
              </ul>
            </div>
          )}
          {comparison.problems.resolved.length > 0 && (
            <div className="text-success-text">
              <p className="font-medium">Resolved problems:</p>
              <ul className="list-disc pl-4">
                {comparison.problems.resolved.map((problem) => {
                  const text = problemText(problem);
                  return <li key={text}>{text}</li>;
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
