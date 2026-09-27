import Link from "next/link";
import { redirect } from "next/navigation";
import { hasAnyPlayers, PASSWORD_MIN_LENGTH } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { getCurrentActor } from "@/server/session";
import { RegisterForm } from "./register-form";

export default async function RegisterPage(props: PageProps<"/register">) {
  if ((await getCurrentActor()) !== null) redirect("/");

  const searchParams = await props.searchParams;
  const invite = typeof searchParams.invite === "string" ? searchParams.invite : "";
  const isFirstPlayer = !(await hasAnyPlayers(getContainer().db));

  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      {isFirstPlayer && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Nobody has registered yet. The first account becomes the <strong>admin</strong> and needs
          no invite code.
        </p>
      )}
      <RegisterForm
        needsInvite={!isFirstPlayer}
        inviteCode={invite}
        passwordMinLength={PASSWORD_MIN_LENGTH}
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
