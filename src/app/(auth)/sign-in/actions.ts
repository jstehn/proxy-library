"use server";
// Controller: parse the form, call the use case, turn the Result into what the page shows.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { describeSignInError } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { safeNextPath } from "@/server/next-path";

export type SignInState = { error: string | null; username: string };

const SignInForm = z.object({ username: z.string(), password: z.string() });

export async function signInAction(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const form = SignInForm.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!form.success) return { error: "Please fill in both fields.", username: "" };

  const result = await getContainer().accounts.signIn(form.data, await headers());
  if (!result.ok) return { error: describeSignInError(result.error), username: form.data.username };

  if (result.value.mustChangePassword) redirect("/account/password");
  redirect(safeNextPath(formData.get("next")) ?? "/");
}
