"use server";
import { z } from "zod";
import type { CreateManualClientError } from "@/modules/accounts";
import { parseForm } from "@/server/form-action";
import { formVoid } from "@/server/form-action-instance";
import { readPage } from "@/server/page-instance";
import { assertNever } from "@/shared/kernel";
import { revalidateAdmin } from "../paths";

// Controllers for Admin → Connectors (design doc 69, section 5): make a client by hand for a
// connector that asks for an "OAuth client ID and client secret", or remove one.

/** What the form shows after a client is made. The secret is shown here once and never again. */
export type CreateClientState = {
  error: string | null;
  created: { clientId: string; clientSecret: string | null; name: string } | null;
};

const CreateClientForm = z.object({
  name: z.string().min(1).max(100),
  redirectUris: z.string(),
  kind: z.enum(["confidential", "public"]),
});

export async function createClientAction(
  _previousState: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  const { actor: admin, capabilities } = await readPage({ admin: true });
  const form = parseForm(CreateClientForm, formData);
  if (!form.success)
    return { error: "Give the connector a name and its redirect URLs.", created: null };

  const result = await capabilities.accounts.createManualOAuthClient(admin, {
    name: form.data.name,
    redirectUris: form.data.redirectUris.split(/\s+/).filter((uri) => uri !== ""),
    confidential: form.data.kind === "confidential",
  });
  if (!result.ok) return { error: messageFor(result.error), created: null };

  revalidateAdmin("connectors");
  const { client, clientSecret } = result.value;
  return { error: null, created: { clientId: client.clientId, clientSecret, name: client.name } };
}

const DeleteClientForm = z.object({ clientId: z.string() });

export const deleteClientAction = formVoid(
  DeleteClientForm,
  async ({ actor: admin, capabilities }, input) => {
    const result = await capabilities.accounts.deleteOAuthClient(admin, input);
    // A client that is already gone changes nothing; the list shows what is left.
    if (!result.ok) console.warn("delete connector:", result.error.kind);
    revalidateAdmin("connectors");
  },
  { admin: true },
);

function messageFor(error: CreateManualClientError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can add connectors.";
    case "OAuthClientInvalid":
      return error.reason;
    default:
      return assertNever(error);
  }
}
