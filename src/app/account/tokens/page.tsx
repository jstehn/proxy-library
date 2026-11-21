import Link from "next/link";
import { LocalTime } from "@/ui/local-time";
import { revokeTokenAction } from "./actions";
import { ConnectSnippets } from "./connect-snippets";
import { CreateTokenForm } from "./create-token-form";
import { readPage } from "@/server/page-instance";
import { Card } from "@/ui/card";
import { EmptyState } from "@/ui/empty-state";
import { ConfirmButton } from "@/ui/confirm-button";

// Access tokens for LLM clients (design doc 28, section 9): make one, see it once, revoke it.

const SCOPE_WORDS: Readonly<Record<string, string>> = {
  read: "read",
  "decks:write": "edit decks",
  "wishlist:write": "edit wishlist",
};

export default async function TokensPage() {
  const { actor, capabilities, reads } = await readPage();

  const tokens = await reads.accounts.listAccessTokens(actor);
  const mcpUrl = new URL("/api/mcp", capabilities.site.appUrl).toString();
  const openApiUrl = new URL("/api/tools/openapi.json", capabilities.site.appUrl).toString();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-muted text-sm underline">
          Account
        </Link>
        <h1 className="text-2xl font-semibold">Connect an LLM</h1>
        <p className="text-muted text-sm">
          An access token lets an AI assistant (any app that speaks MCP, or calls tools from an
          OpenAPI description) look at your cards, decks and wishlist and help build decks, as you.
          Give each app its own token, and revoke one you no longer use.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Claude on the web, and other web connectors</h2>
        <p className="text-muted text-sm">
          No token needed: in claude.ai, open Settings → Connectors → Add custom connector, and give
          it <code className="break-all">{mcpUrl}</code>. It sends you to Proxy Library to approve
          it, and then shows up in the list below.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Make a token</h2>
        <CreateTokenForm mcpUrl={mcpUrl} openApiUrl={openApiUrl} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Your tokens</h2>
        {tokens.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <Card as="ul" divided className="flex flex-col">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium break-words">{token.name}</span>
                  <span className="text-muted text-xs">
                    <code>pl_{token.prefix}…</code> ·{" "}
                    {token.scopes.map((scope) => SCOPE_WORDS[scope] ?? scope).join(", ")} · made{" "}
                    <LocalTime iso={token.createdAt.toISOString()} /> ·{" "}
                    {token.lastUsedAt === null ? (
                      "never used"
                    ) : (
                      <>
                        last used <LocalTime iso={token.lastUsedAt.toISOString()} />
                      </>
                    )}
                  </span>
                </div>
                <form action={revokeTokenAction}>
                  <input type="hidden" name="tokenId" value={token.id} />
                  <ConfirmButton
                    variant="secondary"
                    size="sm"
                    question="Revoke this access token? Anything using it stops working."
                    confirmLabel="Revoke"
                  >
                    Revoke
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Setting it up</h2>
        <p className="text-muted text-sm">
          The address is <code className="break-all">{mcpUrl}</code>. Replace{" "}
          <code>pl_YOUR_TOKEN</code> with the token you made. From outside your home network, the
          app must be served over HTTPS.
        </p>
        <ConnectSnippets secret="pl_YOUR_TOKEN" mcpUrl={mcpUrl} openApiUrl={openApiUrl} />
      </section>
    </main>
  );
}
