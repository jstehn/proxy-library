"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { describeRegisterPlayerError } from "@/modules/accounts";
import { getContainer } from "@/server/container";

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
  const form = RegisterForm.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    inviteCode: formData.get("inviteCode") ?? undefined,
  });
  if (!form.success) {
    return {
      error: "Please fill in every field.",
      values: { username: "", displayName: "", inviteCode: "" },
    };
  }
  const { username, displayName, password, inviteCode } = form.data;

  const { accounts } = getContainer();
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
