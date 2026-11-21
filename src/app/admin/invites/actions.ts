"use server";
import { z } from "zod";
import type { CreateInviteError, RevokeInviteError } from "@/modules/accounts";
import { assertNever } from "@/shared/kernel";
import { parseForm } from "@/server/form-action";
import { formVoid } from "@/server/form-action-instance";
import { readPage } from "@/server/page-instance";
import { revalidateAdmin } from "../paths";

export type CreateInviteState = {
  error: string | null;
  created: { code: string; link: string; expiresAt: string } | null;
};

const CreateInviteForm = z.object({ validForDays: z.coerce.number() });

export async function createInviteAction(
  _previousState: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const { actor: admin, capabilities } = await readPage({ admin: true });
  const form = parseForm(CreateInviteForm, formData);
  if (!form.success)
    return { error: "Choose how many days the invite should last.", created: null };

  const { accounts } = capabilities;
  const invite = await accounts.createInvite(admin, form.data);
  if (!invite.ok) return { error: createMessageFor(invite.error), created: null };

  revalidateAdmin("invites");
  const link = new URL(
    `/register?invite=${invite.value.code}`,
    capabilities.site.appUrl,
  ).toString();
  return {
    error: null,
    created: { code: invite.value.code, link, expiresAt: invite.value.expiresAt.toISOString() },
  };
}

const RevokeInviteForm = z.object({ code: z.string() });

export const revokeInviteAction = formVoid(
  RevokeInviteForm,
  async ({ actor: admin, capabilities }, input) => {
    const result = await capabilities.accounts.revokeInvite(admin, input);
    // Revoking an invite that's already used or gone changes nothing; the list shows its state.
    if (!result.ok) console.warn("revoke invite:", revokeMessageFor(result.error));
    revalidateAdmin("invites");
  },
  { admin: true },
);

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
