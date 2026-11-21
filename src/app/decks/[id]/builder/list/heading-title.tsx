"use client";
import { useState } from "react";

/**
 * A heading of the deck's own, with ↑ ↓ to move it and Rename (design doc 34). Renaming onto
 * another heading merges the two; Clear takes it off its cards, which go back to their type.
 */
export function HeadingTitle(props: {
  heading: string;
  title: string;
  headings: readonly string[];
  busy: boolean;
  onMove?: (heading: string, direction: "up" | "down") => void;
  onRename: (from: string, to: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(props.heading);
  const index = props.headings.indexOf(props.heading);
  const small =
    "rounded border border-line px-1.5 text-xs leading-5 normal-case disabled:opacity-40";

  if (renaming) {
    const merges = name.trim() !== props.heading && props.headings.includes(name.trim());
    return (
      <form
        className="flex flex-wrap items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          setRenaming(false);
          if (name.trim() !== props.heading) props.onRename(props.heading, name);
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`New name for ${props.heading}`}
          maxLength={40}
          autoFocus
          className="border-line min-w-0 flex-1 rounded border bg-transparent px-1.5 py-0.5 text-sm"
        />
        <button type="submit" className={small}>
          {merges ? "Merge" : "Save"}
        </button>
        <button
          type="button"
          className={small}
          onClick={() => {
            setRenaming(false);
            props.onRename(props.heading, null);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className={small}
          onClick={() => {
            setRenaming(false);
            setName(props.heading);
          }}
        >
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <h3 className="text-muted min-w-0 flex-1 truncate text-xs font-medium tracking-wide uppercase">
        {props.title}
      </h3>
      {props.onMove !== undefined && (
        <>
          <button
            type="button"
            className={small}
            disabled={props.busy || index <= 0}
            onClick={() => props.onMove?.(props.heading, "up")}
            aria-label={`Move ${props.heading} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className={small}
            disabled={props.busy || index < 0 || index >= props.headings.length - 1}
            onClick={() => props.onMove?.(props.heading, "down")}
            aria-label={`Move ${props.heading} down`}
          >
            ↓
          </button>
        </>
      )}
      <button
        type="button"
        className={small}
        disabled={props.busy}
        onClick={() => {
          setName(props.heading);
          setRenaming(true);
        }}
        aria-label={`Rename ${props.heading}`}
      >
        Rename
      </button>
    </div>
  );
}
