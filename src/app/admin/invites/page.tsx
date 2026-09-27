import {
  INVITE_DEFAULT_DAYS,
  INVITE_MAX_DAYS,
  INVITE_MIN_DAYS,
  listInvites,
} from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { SubmitButton } from "@/ui/form";
import { revokeInviteAction } from "./actions";
import { CreateInviteForm } from "./create-invite-form";

export default async function AdminInvitesPage() {
  await requireAdminActor();
  const { db, clock } = getContainer();
  const invites = await listInvites(db, clock.now());

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
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
        {invites.length === 0 && <p className="text-sm text-zinc-500">No invites yet.</p>}
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <li
              key={invite.code}
              className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <code className="font-semibold">{invite.code}</code>
              <span className="text-zinc-500">{invite.status}</span>
              <span className="text-zinc-500">
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
    </main>
  );
}
