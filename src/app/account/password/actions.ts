"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { describeChangeOwnPasswordError } from "@/modules/accounts";
import { readPage } from "@/server/page-instance";

export type ChangePasswordState = { error: string | null; success: boolean };

const ChangePasswordForm = z.object({ currentPassword: z.string(), newPassword: z.string() });

export async function changePasswordAction(
  _previousState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const { actor, capabilities } = await readPage({ allowPasswordChangePending: true });
  const form = ChangePasswordForm.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!form.success) return { error: "Please fill in both fields.", success: false };

  const result = await capabilities.accounts.changeOwnPassword(actor, form.data, await headers());
  if (!result.ok) return { error: describeChangeOwnPasswordError(result.error), success: false };

  // After a forced change, carry on into the app.
  if (actor.mustChangePassword) redirect("/");
  return { error: null, success: true };
}
