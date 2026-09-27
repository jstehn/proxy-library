"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CreateInviteError, RevokeInviteError } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { assertNever } from "@/shared/kernel";

export type CreateInviteState = {
  error: string | null;
  created: { code: string; link: string; expiresAt: string } | null;
};

const CreateInviteForm = z.object({ validForDays: z.coerce.number() });

export async function createInviteAction(
  _previousState: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const admin = await requireAdminActor();
  const form = CreateInviteForm.safeParse({ validForDays: formData.get("validForDays") });
  if (!form.success)
    return { error: "Choose how many days the invite should last.", created: null };

  const { accounts, config } = getContainer();
  const invite = await accounts.createInvite(admin, form.data);
  if (!invite.ok) return { error: createMessageFor(invite.error), created: null };

  revalidatePath("/admin/invites");
  const link = new URL(`/register?invite=${invite.value.code}`, config.appUrl).toString();
  return {
    error: null,
    created: { code: invite.value.code, link, expiresAt: invite.value.expiresAt.toISOString() },
  };
}

const RevokeInviteForm = z.object({ code: z.string() });

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActor();
  const form = RevokeInviteForm.safeParse({ code: formData.get("code") });
  if (!form.success) return;

  const result = await getContainer().accounts.revokeInvite(admin, form.data);
  // Revoking an invite that's already used or gone changes nothing; the list shows its state.
  if (!result.ok) console.warn("revoke invite:", revokeMessageFor(result.error));
  revalidatePath("/admin/invites");
}

function createMessageFor(error: CreateInviteError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can create invites.";
    case "InviteDurationInvalid":
      return "Invites can last from 1 to 30 days.";
    default:
      return assertNever(error);
  }
}

function revokeMessageFor(error: RevokeInviteError): string {
  switch (error.kind) {
    case "Forbidden":
      return "not an admin";
    case "InviteNotFound":
      return "no such invite";
    case "InviteNotOpen":
      return `invite already ${error.status}`;
    default:
      return assertNever(error);
  }
}
