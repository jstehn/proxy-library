import { INVITE_DEFAULT_DAYS, INVITE_MAX_DAYS, INVITE_MIN_DAYS } from "@/modules/accounts";
import { SubmitButton } from "@/ui/form";
import { revokeInviteAction } from "./actions";
import { CreateInviteForm } from "./create-invite-form";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";
import { EmptyState } from "@/ui/empty-state";

export default async function AdminInvitesPage() {
  const { actor: admin, capabilities, reads } = await readPage({ admin: true });

  const invites = await reads.accounts.listInvites(admin, capabilities.now());

  return (
    <Page width="3xl" spacing="roomy">
      <h1 className="text-2xl font-semibold">Invites</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Create an invite</h2>
        <CreateInviteForm
          defaultDays={INVITE_DEFAULT_DAYS}
          minDays={INVITE_MIN_DAYS}
          maxDays={INVITE_MAX_DAYS}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">All invites</h2>
        {invites.length === 0 && <EmptyState>No invites yet.</EmptyState>}
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <li
              key={invite.code}
              className="border-border-subtle flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <code className="font-semibold">{invite.code}</code>
              <span className="text-muted">{invite.status}</span>
              <span className="text-muted">
                {invite.usedBy !== null
                  ? `used by @${invite.usedBy}`
                  : `expires ${invite.expiresAt.slice(0, 10)}`}
              </span>
              <span className="flex-1" />
              {invite.status === "open" && (
                <form action={revokeInviteAction}>
                  <input type="hidden" name="code" value={invite.code} />
                  <SubmitButton tone="secondary" pendingText="…">
                    Revoke
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
