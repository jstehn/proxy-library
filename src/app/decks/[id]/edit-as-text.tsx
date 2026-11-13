"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  previewListAction,
  replaceListAction,
  type EditAsTextPreviewState,
  type EditAsTextState,
} from "../actions";

// Edit as text (design doc 23): the deck's whole list in a text box; saving replaces the deck.

const initialState: EditAsTextState = { error: null, problems: [] };
const initialPreviewState: EditAsTextPreviewState = {
  error: null,
  problems: [],
  preview: null,
  previewedList: null,
};

const button =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700";

type Props = Readonly<{ deckId: number; text: string; fingerprint: string }>;

export function EditAsText({ deckId, text, fingerprint }: Props) {
  const [state, formAction, savePending] = useActionState(replaceListAction, initialState);
  const [previewState, previewAction, previewPending] = useActionState(
    previewListAction,
    initialPreviewState,
  );
  const pending = savePending || previewPending;
  // Controlled, so the text survives a save that fails: React resets uncontrolled form fields
  // after an action runs.
  const [list, setList] = useState(text);
  const [lastMode, setLastMode] = useState<"save" | "preview">("save");
  const details = useRef<HTMLDetailsElement>(null);
  const saveError = state.error === null ? null : { error: state.error, problems: state.problems };
  const previewError =
    previewState.error === null
      ? null
      : { error: previewState.error, problems: previewState.problems };
  const activeError =
    lastMode === "preview" ? (previewError ?? saveError) : (saveError ?? previewError);
  const preview = previewState.preview;
  const previewIsStale = preview !== null && previewState.previewedList !== list;

  // The header's "Edit as text" link points at #edit-as-text: open the box and bring it into
  // view. A click listener, not "hashchange", so the link still works when the address already
  // ends in #edit-as-text (after the box was closed again).
  useEffect(() => {
    function show() {
      if (details.current === null) return;
      details.current.open = true;
      details.current.scrollIntoView({ block: "start" });
    }
    function onClick(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('a[href="#edit-as-text"]')) {
        event.preventDefault();
        show();
      }
    }
    if (window.location.hash === "#edit-as-text") show();
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function cancel() {
    setList(text);
    if (details.current !== null) details.current.open = false;
  }

  return (
    <details
      ref={details}
      id="edit-as-text"
      className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <summary className="cursor-pointer font-medium">Edit as text</summary>
      <form action={formAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="deckId" value={deckId} />
        <input type="hidden" name="fingerprint" value={fingerprint} />
        <p className="text-muted text-xs">
          Saving replaces the whole deck with this list: cards you delete here leave the deck.
          Headings like &quot;Commander&quot;, &quot;Sideboard&quot; or &quot;Lands (36)&quot;
          choose the board. Cards without &quot;(SET) number&quot; keep their printing, and new ones
          use your most special copy.
        </p>
        <textarea
          name="list"
          rows={30}
          value={list}
          onChange={(event) => setList(event.target.value)}
          aria-label="The deck's list as text"
          aria-describedby={activeError === null ? undefined : `edit-as-text-error-${deckId}`}
          spellCheck={false}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-sm dark:border-zinc-700"
        />
        {activeError !== null && (
          <div
            id={`edit-as-text-error-${deckId}`}
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            <p>{activeError.error}</p>
            {activeError.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {activeError.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview !== null && (
          <section
            aria-live="polite"
            aria-label="Preview of changes"
            className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900/60"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
              <span>Preview (not saved yet)</span>
              {previewIsStale && (
                <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                  List edited since preview — click Preview changes again to refresh
                </span>
              )}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div>
                <span className="text-muted text-xs">Cards</span>
                <p>
                  {preview.beforeCards} → {preview.afterCards} (
                  {preview.exactSize ? `needs ${preview.targetSize}` : `min ${preview.targetSize}`})
                </p>
              </div>
              <div>
                <span className="text-muted text-xs">Avg. mana value</span>
                <p>
                  {preview.beforeAverageManaValue.toFixed(2)} →{" "}
                  {preview.afterAverageManaValue.toFixed(2)}
                </p>
              </div>
              {preview.bracketAfter !== null && (
                <div>
                  <span className="text-muted text-xs">Bracket</span>
                  <p>
                    {preview.bracketBefore} → {preview.bracketAfter}
                  </p>
                </div>
              )}
            </div>
            {preview.roles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                {preview.roles.map((role) => (
                  <span key={role.tag}>
                    {role.label}: {role.before} → {role.after}
                    {role.target !== null ? ` / ${role.target}` : ""}
                  </span>
                ))}
              </div>
            )}
            {preview.changes.length === 0 ? (
              <p className="text-muted mt-2 text-xs">No card quantities changed.</p>
            ) : (
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                {preview.changes.length} line{preview.changes.length === 1 ? "" : "s"} changed:{" "}
                {preview.changes
                  .slice(0, 8)
                  .map(
                    (change) =>
                      `${change.name} (${change.board}: ${change.before}→${change.after})`,
                  )
                  .join(", ")}
                {preview.changes.length > 8 ? ` (+${preview.changes.length - 8} more)` : ""}
              </p>
            )}
            {preview.bracketWarningAfter !== null && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {preview.bracketWarningAfter}
              </p>
            )}
            {preview.problemsAdded.length > 0 && (
              <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                <p className="font-medium">New problems:</p>
                <ul className="list-disc pl-5">
                  {preview.problemsAdded.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.problemsResolved.length > 0 && (
              <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                <p className="font-medium">Resolved problems:</p>
                <ul className="list-disc pl-5">
                  {preview.problemsResolved.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.problemsAdded.length === 0 &&
              preview.problemsResolved.length === 0 &&
              preview.problemsRemainingCount > 0 && (
                <p className="text-muted mt-2 text-xs">
                  {preview.problemsRemainingCount} existing problem
                  {preview.problemsRemainingCount === 1 ? "" : "s"} unchanged.
                </p>
              )}
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            onClick={() => setLastMode("save")}
            className={button}
          >
            {savePending ? "Saving…" : "Save list"}
          </button>
          <button
            type="submit"
            formAction={previewAction}
            disabled={pending}
            onClick={() => setLastMode("preview")}
            className={button}
          >
            {previewPending ? "Previewing…" : "Preview changes"}
          </button>
          <button type="button" onClick={cancel} disabled={pending} className={button}>
            Cancel
          </button>
        </div>
      </form>
    </details>
  );
}
