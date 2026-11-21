import type { Metadata } from "next";
import { readPage } from "@/server/page-instance";
import { SubmitButton } from "@/ui/form";
import { deleteClientAction } from "./actions";
import { CreateClientForm } from "./create-client-form";

export const metadata: Metadata = { title: "Connectors" };

// Admin → Connectors (design doc 69, section 5): the OAuth clients, made by hand or registered by
// the apps themselves. Deleting one revokes every token it made.

export default async function AdminConnectorsPage() {
  const { actor: admin, reads } = await readPage({ admin: true });
  const clients = await reads.accounts.listOAuthClients(admin);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <h1 className="text-2xl font-semibold">Connectors</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Add a client by hand</h2>
        <p className="text-muted text-sm">
          For a connector that asks for an OAuth client ID and client secret instead of registering
          itself. Paste the redirect URL it shows; the ID and secret appear once.
        </p>
        <CreateClientForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">All clients</h2>
        {clients.length === 0 && <p className="text-muted text-sm">No clients yet.</p>}
        <ul className="flex flex-col gap-2">
          {clients.map((client) => (
            <li
              key={client.clientId}
              className="border-border-subtle flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold break-words">{client.name}</span>
                <code className="text-muted text-xs break-all">{client.clientId}</code>
                <span className="text-muted text-xs break-all">
                  {client.redirectUris.join(", ")}
                </span>
                <span className="text-muted text-xs">
                  {client.authMethod === "none" ? "public" : `secret (${client.authMethod})`} ·{" "}
                  {client.createdBy === null ? "registered itself" : `made by @${client.createdBy}`}{" "}
                  · {client.createdAt.slice(0, 10)} · {client.liveTokens} live token
                  {client.liveTokens === 1 ? "" : "s"}
                </span>
              </div>
              <form action={deleteClientAction}>
                <input type="hidden" name="clientId" value={client.clientId} />
                <SubmitButton tone="danger" pendingText="…">
                  Delete
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
