"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Board, SnapshotComparison, SnapshotSummary } from "@/modules/decks";
import {
  checkSnapshotLabel,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
} from "@/modules/decks/client";
import { estimateLabel, problemText, TAG_LABELS } from "../../labels";
import {
  compareSnapshotAction,
  deleteSnapshotAction,
  listSnapshotsAction,
  restoreSnapshotAction,
  saveSnapshotAction,
  type BuilderDeck,
} from "./actions";

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
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const latestCompare = useRef(0);

  // Load snapshots when opening the panel.
  useEffect(() => {
    let cancelled = false;
    void listSnapshotsAction(deckId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSnapshots(result.snapshots);
        setLoadError(null);
      } else {
        setLoadError(result.message);
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
      (result) => {
        if (request !== latestCompare.current) return;
        if (result.ok) setComparison(result.comparison);
      },
    );
  }, [deckId, deckKey, beforeId, afterId]);

  async function runCompare(nextBeforeId: number, nextAfterId: number | null) {
    setBeforeId(nextBeforeId);
    setAfterId(nextAfterId);
    setComparing(true);
    const request = ++latestCompare.current;
    const result = await compareSnapshotAction({
      deckId,
      beforeSnapshotId: nextBeforeId,
      afterSnapshotId: nextAfterId,
    });
    if (request !== latestCompare.current) return;
    setComparing(false);
    if (result.ok) {
      setComparison(result.comparison);
    } else {
      onError(result.message);
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
    const result = await saveSnapshotAction({ deckId, label: checked.value });
    setWorking(false);
    if (!result.ok) {
      setLabelError(result.message);
      onError(result.message);
      return;
    }
    setSnapshots(result.snapshots);
    setLabel("");
    setStatusMessage(`Saved snapshot “${checked.value}”.`);
  }

  async function restore(snapshot: SnapshotSummary) {
    setWorking(true);
    const result = await restoreSnapshotAction({ deckId, snapshotId: snapshot.id });
    setWorking(false);
    setConfirmRestoreId(null);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    const msg = `Restored “${snapshot.label}” (${result.cardCount} ${result.cardCount === 1 ? "card" : "cards"}).`;
    setStatusMessage(msg);
    onRestored(result.deck, msg);
  }

  async function remove(snapshot: SnapshotSummary) {
    setWorking(true);
    const result = await deleteSnapshotAction({ deckId, snapshotId: snapshot.id });
    setWorking(false);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    setSnapshots(result.snapshots);
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
      className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium">Snapshots</h3>
          {snapshots !== null && (
            <span className="text-xs text-zinc-500">
              {snapshots.length}/{MAX_SNAPSHOTS_PER_DECK}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Close
        </button>
      </div>

      <form onSubmit={save} className="flex flex-col gap-1.5">
        <label htmlFor={labelId} className="text-xs text-zinc-500">
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
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          />
          <button
            type="submit"
            disabled={busy || atLimit}
            className="rounded border border-zinc-300 px-2.5 py-1 text-xs font-medium disabled:opacity-40 dark:border-zinc-700"
          >
            Save
          </button>
        </div>
        {labelError !== null && (
          <p id={labelErrorId} role="status" className="text-xs text-red-700 dark:text-red-300">
            {labelError}
          </p>
        )}
        {atLimit && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Limit of {MAX_SNAPSHOTS_PER_DECK} snapshots reached. Delete an older one to save more.
          </p>
        )}
      </form>

      {statusMessage !== null && (
        <p role="status" className="text-xs text-zinc-600 dark:text-zinc-300">
          {statusMessage}
        </p>
      )}

      {loadError !== null ? (
        <p className="text-xs text-red-700 dark:text-red-300">{loadError}</p>
      ) : snapshots === null ? (
        <p className="text-xs text-zinc-500">Loading snapshots…</p>
      ) : snapshots.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No snapshots saved yet. Save one to compare before and after edits.
        </p>
      ) : (
        <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-xs">
          {snapshots.map((snapshot) => {
            const snapshotId = Number(snapshot.id);
            const isComparing = beforeId === snapshotId;
            const confirmingRestore = confirmRestoreId === snapshotId;
            return (
              <li
                key={snapshotId}
                className={`flex flex-col gap-1 rounded border p-2 ${
                  isComparing
                    ? "border-sky-400 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/30"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium" title={snapshot.label}>
                    {snapshot.label}
                  </span>
                  <span className="shrink-0 text-zinc-500 tabular-nums">
                    {snapshot.cardCount} {snapshot.cardCount === 1 ? "card" : "cards"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-500">
                  <span>{formatTimestamp(snapshot.createdAt)}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy || comparing}
                      onClick={() => void runCompare(snapshotId, null)}
                      className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      {isComparing ? "Comparing" : "Compare"}
                    </button>
                    {confirmingRestore ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void restore(snapshot)}
                          className="rounded bg-amber-600 px-1.5 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
                        >
                          Confirm restore
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmRestoreId(null)}
                          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] dark:border-zinc-700"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmRestoreId(snapshotId)}
                        className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(snapshot)}
                      className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-zinc-700 dark:text-red-300 dark:hover:bg-red-950"
                    >
                      Delete
                    </button>
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
          className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/50"
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
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Hide diff
            </button>
          </div>
          {snapshots.length > 1 && beforeId !== null && (
            <label className="flex items-center gap-2 text-zinc-500">
              <span>Compare against:</span>
              <select
                value={afterId ?? ""}
                disabled={comparing}
                onChange={(event) => {
                  const next = event.target.value;
                  void runCompare(beforeId, next === "" ? null : Number(next));
                }}
                className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-xs text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
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
              <span className="text-zinc-500">Cards</span>
              <p className="font-medium tabular-nums">
                {comparison.before.stats.cardCount} → {comparison.after.stats.cardCount}
              </p>
            </div>
            <div>
              <span className="text-zinc-500">Avg. mana value</span>
              <p className="font-medium tabular-nums">
                {comparison.before.stats.averageManaValue.toFixed(2)} →{" "}
                {comparison.after.stats.averageManaValue.toFixed(2)}
              </p>
            </div>
            {comparison.bracket.before !== null && comparison.bracket.after !== null && (
              <div>
                <span className="text-zinc-500">Bracket</span>
                <p className="font-medium tabular-nums">
                  {estimateLabel(comparison.bracket.before)} →{" "}
                  {estimateLabel(comparison.bracket.after)}
                </p>
              </div>
            )}
          </div>

          {comparison.roles.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-600 dark:text-zinc-300">
              {comparison.roles.map((role) => (
                <span key={role.tag}>
                  {TAG_LABELS[role.tag]}: {role.before} → {role.after}
                </span>
              ))}
            </div>
          )}

          {comparison.changes.length === 0 ? (
            <p className="text-zinc-500">No card changes between these two lists.</p>
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
                            ? "mr-1 font-semibold text-emerald-700 dark:text-emerald-400"
                            : "mr-1 font-semibold text-red-700 dark:text-red-400"
                        }
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                      {change.name}{" "}
                      <span className="text-zinc-500">({BOARD_NAMES[change.board]})</span>
                    </span>
                    <span className="shrink-0 text-zinc-500 tabular-nums">
                      {change.beforeQuantity} → {change.afterQuantity}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {comparison.problems.added.length > 0 && (
            <div className="text-red-700 dark:text-red-300">
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
            <div className="text-emerald-700 dark:text-emerald-300">
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
