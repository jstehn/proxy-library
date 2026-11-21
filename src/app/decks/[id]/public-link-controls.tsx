"use client";

import Link from "next/link";
import { useState } from "react";
import { enablePublicLinkAction, revokePublicLinkAction, rotatePublicLinkAction } from "../actions";
import { Button } from "@/ui/button";

/** Owner controls for a deck's unauthenticated `/d/[token]` link (design doc 47). */
export function PublicLinkControls(props: { deckId: number; publicToken: string | null }) {
  const [copied, setCopied] = useState(false);

  if (props.publicToken === null) {
    return (
      <form action={enablePublicLinkAction} className="flex items-center gap-2 text-sm">
        <input type="hidden" name="deckId" value={props.deckId} />
        <span className="text-muted">Public link: off.</span>
        <Button type="submit" variant="secondary" size="sm">
          Create public link
        </Button>
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
      <Button type="button" onClick={copyLink} variant="secondary" size="xs">
        {copied ? "Copied!" : "Copy"}
      </Button>
      <form action={rotatePublicLinkAction}>
        <input type="hidden" name="deckId" value={props.deckId} />
        <Button
          type="submit"

          title="Generate a new link and invalidate the current one"
          variant="secondary"
          size="xs"
        >
          New link
        </Button>
      </form>
      <form action={revokePublicLinkAction}>
        <input type="hidden" name="deckId" value={props.deckId} />
        <button
          type="submit"
          className="border-line text-danger-text rounded-md border px-2.5 py-1 text-xs"
        >
          Turn off
        </button>
      </form>
    </div>
  );
}
