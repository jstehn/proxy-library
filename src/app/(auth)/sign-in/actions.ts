"use server";
// Controller: parse the form, call the use case, turn the Result into what the page shows.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { describeSignInError } from "@/modules/accounts";
import { readPage } from "@/server/page-instance";
import { safeNextPath } from "@/server/next-path";

export type SignInState = { error: string | null; username: string };

const SignInForm = z.object({ username: z.string(), password: z.string() });

/** Starts signing in with Authentik: sends the browser to it (design doc 69, section 4.5). */
export async function signInWithExternalAction(formData: FormData): Promise<void> {
  const { capabilities } = await readPage({ allowVisitors: true });
  const url = await capabilities.accounts.startExternalSignIn(
    { next: safeNextPath(formData.get("next")) },
    await headers(),
  );
  redirect(url ?? "/sign-in?error=unavailable");
}

export async function signInAction(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const form = SignInForm.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!form.success) return { error: "Please fill in both fields.", username: "" };

  const { capabilities } = await readPage({ allowVisitors: true });
  const result = await capabilities.accounts.signIn(form.data, await headers());
  if (!result.ok) return { error: describeSignInError(result.error), username: form.data.username };

  if (result.value.mustChangePassword) redirect("/account/password");
  redirect(safeNextPath(formData.get("next")) ?? "/");
}
