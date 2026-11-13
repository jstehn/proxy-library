"use client";
import { useActionState, useState } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { createTokenAction, type CreateTokenState } from "./actions";
import { ConnectSnippets } from "./connect-snippets";

const initialState: CreateTokenState = { kind: "idle" };

/** Makes a token; its secret is shown once, with setup snippets that include it. */
export function CreateTokenForm(props: { mcpUrl: string; openApiUrl: string }) {
  const [state, formAction] = useActionState(createTokenAction, initialState);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <TextField
          label="Name"
          name="name"
          hint="Where you'll use it, so you can tell tokens apart: “LM Studio on the desktop”."
        />
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">It may</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked disabled /> read your account, cards, decks and wishlist
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="scope" value="decks:write" defaultChecked /> build and edit
            your decks
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="scope" value="wishlist:write" defaultChecked /> add to and
            change your wishlist
          </label>
          <span className="text-muted text-xs">
            No token can buy, sell, open packs, trade or delete anything.
          </span>
        </fieldset>
        <div>
          <SubmitButton pendingText="Making…">Make a token</SubmitButton>
        </div>
      </form>

      {state.kind === "error" && <Alert tone="error">{state.message}</Alert>}
      {state.kind === "created" && (
        <div className="flex flex-col gap-3 rounded-lg border border-green-300 p-4 dark:border-green-800">
          <p className="text-sm">
            <strong>{state.name}</strong> is ready. Copy it now:{" "}
            <strong>you won&apos;t see it again</strong>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded bg-zinc-100 px-2 py-1 text-xs break-all dark:bg-zinc-800">
              {state.secret}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(state.secret).then(() => setCopied(true));
              }}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ConnectSnippets
            secret={state.secret}
            mcpUrl={props.mcpUrl}
            openApiUrl={props.openApiUrl}
          />
        </div>
      )}
    </div>
  );
}
