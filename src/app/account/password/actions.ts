"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ChangeOwnPasswordError } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever } from "@/shared/kernel";

export type ChangePasswordState = { error: string | null; success: boolean };

const ChangePasswordForm = z.object({ currentPassword: z.string(), newPassword: z.string() });

export async function changePasswordAction(
  _previousState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const actor = await requireActor({ allowPasswordChangePending: true });
  const form = ChangePasswordForm.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!form.success) return { error: "Please fill in both fields.", success: false };

  const result = await getContainer().accounts.changeOwnPassword(actor, form.data, await headers());
  if (!result.ok) return { error: messageFor(result.error), success: false };

  // After a forced change, carry on into the app.
  if (actor.mustChangePassword) redirect("/");
  return { error: null, success: true };
}

function messageFor(error: ChangeOwnPasswordError): string {
  switch (error.kind) {
    case "PasswordInvalid":
      return `New password ${error.reason}.`;
    case "InvalidCredentials":
      return "Your current password isn't right.";
    case "PlayerNotFound":
      return "Your account could not be found. Try signing in again.";
    default:
      return assertNever(error);
  }
}
