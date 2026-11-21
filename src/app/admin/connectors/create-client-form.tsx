"use client";
import { useActionState } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { createClientAction, type CreateClientState } from "./actions";
import { Textarea } from "@/ui/field";

const initialState: CreateClientState = { error: null, created: null };

export function CreateClientForm() {
  const [state, formAction] = useActionState(createClientAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <TextField label="Name" name="name" hint="What the connector is, e.g. Google." />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Redirect URLs</span>
        <Textarea name="redirectUris" required rows={3} controlSize="form" />
        <span className="text-muted text-xs">
          Exactly as the connector shows them, one per line (https, or http on localhost). No
          wildcards.
        </span>
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium">Client type</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="confidential" defaultChecked /> Confidential (has a
          secret: use this when the connector asks for one)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="public" /> Public (no secret, PKCE only)
        </label>
      </fieldset>
      <div>
        <SubmitButton pendingText="Creating…">Create client</SubmitButton>
      </div>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.created && (
        <Alert tone="success">
          Created {state.created.name}. Client ID:{" "}
          <code className="font-semibold break-all">{state.created.clientId}</code>
          {state.created.clientSecret !== null && (
            <>
              . Client secret (shown once, copy it now):{" "}
              <code className="font-semibold break-all">{state.created.clientSecret}</code>
            </>
          )}
          . Paste them into the connector, then approve it when it sends you back here.
        </Alert>
      )}
    </form>
  );
}
