"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RegisterPlayerError } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { assertNever } from "@/shared/kernel";

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
    return { error: messageFor(registered.error), values: { username, displayName, inviteCode } };
  }

  // Registration succeeded, so sign the new player straight in.
  await accounts.signIn({ username, password }, await headers());
  redirect("/");
}

function messageFor(error: RegisterPlayerError): string {
  switch (error.kind) {
    case "UsernameInvalid":
      return `Username ${error.reason}.`;
    case "DisplayNameInvalid":
      return `Display name ${error.reason}.`;
    case "PasswordInvalid":
      return `Password ${error.reason}.`;
    case "UsernameTaken":
      return "That username is taken. Try another.";
    case "InviteRequired":
      return "You need an invite code from an admin to register.";
    case "InviteNotFound":
      return "That invite code doesn't exist. Check it for typos.";
    case "InviteNotOpen":
      return `That invite code has been ${error.status === "revoked" ? "cancelled" : error.status}. Ask an admin for a new one.`;
    default:
      return assertNever(error);
  }
}
