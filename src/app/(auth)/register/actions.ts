"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { describeRegisterPlayerError } from "@/modules/accounts";
import { parseForm } from "@/server/form-action";
import { readPage } from "@/server/page-instance";

export type RegisterState = {
  error: string | null;
  values: { username: string; displayName: string; inviteCode: string };
};

const RegisterForm = z.object({
  username: z.string(),
  displayName: z.string(),
  password: z.string(),
  inviteCode: z.string().default(""),
});

export async function registerAction(
  _previousState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const form = parseForm(RegisterForm, formData);
  if (!form.success) {
    return {
      error: "Please fill in every field.",
      values: { username: "", displayName: "", inviteCode: "" },
    };
  }
  const { username, displayName, password, inviteCode } = form.data;

  const { capabilities } = await readPage({ allowVisitors: true });
  const { accounts } = capabilities;
  const registered = await accounts.registerPlayer({ username, displayName, password, inviteCode });
  if (!registered.ok) {
    return {
      error: describeRegisterPlayerError(registered.error),
      values: { username, displayName, inviteCode },
    };
  }

  // Registration succeeded, so sign the new player straight in.
  await accounts.signIn({ username, password }, await headers());
  redirect("/");
}
