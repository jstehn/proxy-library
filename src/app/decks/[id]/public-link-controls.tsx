"use client";

import Link from "next/link";
import { useState } from "react";
import { enablePublicLinkAction, revokePublicLinkAction, rotatePublicLinkAction } from "../actions";

/** Owner controls for a deck's unauthenticated `/d/[token]` link (design doc 47). */
export function PublicLinkControls(props: { deckId: number; publicToken: string | null }) {
  const [copied, setCopied] = useState(false);

  if (props.publicToken === null) {
    return (
      <form action={enablePublicLinkAction} className="flex items-center gap-2 text-sm">
        <input type="hidden" name="deckId" value={props.deckId} />
        <span className="text-muted">Public link: off.</span>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700"
        >
          Create public link
        </button>
      </form>
    );
  }

  const path = `/d/${props.publicToken}`;

  async function copyLink() {
    const url = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Public link:</span>
      <Link href={path} className="font-mono text-xs underline">
        {path}
      </Link>
      <button
        type="button"
        onClick={copyLink}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <form action={rotatePublicLinkAction}>
        <input type="hidden" name="deckId" value={props.deckId} />
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
          title="Generate a new link and invalidate the current one"
        >
          New link
        </button>
      </form>
      <form action={revokePublicLinkAction}>
        <input type="hidden" name="deckId" value={props.deckId} />
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-red-700 dark:border-zinc-700 dark:text-red-400"
        >
          Turn off
        </button>
      </form>
    </div>
  );
}
