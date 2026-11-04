"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { replaceListAction, type EditAsTextState } from "../actions";

// Edit as text (design doc 23): the deck's whole list in a text box; saving replaces the deck.

const initialState: EditAsTextState = { error: null, problems: [] };

const button =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700";

type Props = Readonly<{ deckId: number; text: string; fingerprint: string }>;

export function EditAsText({ deckId, text, fingerprint }: Props) {
  const [state, formAction, pending] = useActionState(replaceListAction, initialState);
  // Controlled, so the text survives a save that fails: React resets uncontrolled form fields
  // after an action runs.
  const [list, setList] = useState(text);
  const details = useRef<HTMLDetailsElement>(null);

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
        <p className="text-xs text-zinc-500">
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
          aria-describedby={state.error === null ? undefined : `edit-as-text-error-${deckId}`}
          spellCheck={false}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-sm dark:border-zinc-700"
        />
        {state.error !== null && (
          <div
            id={`edit-as-text-error-${deckId}`}
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            <p>{state.error}</p>
            {state.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {state.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={button}>
            {pending ? "Saving…" : "Save list"}
          </button>
          <button type="button" onClick={cancel} disabled={pending} className={button}>
            Cancel
          </button>
        </div>
      </form>
    </details>
  );
}
