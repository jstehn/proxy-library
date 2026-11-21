import Link from "next/link";
import { redirect } from "next/navigation";
import { PASSWORD_MIN_LENGTH } from "@/modules/accounts";
import { readPage } from "@/server/page-instance";
import { RegisterForm } from "./register-form";

export default async function RegisterPage(props: PageProps<"/register">) {
  const { actor, reads } = await readPage({ allowVisitors: true });
  if (actor !== null) redirect("/");

  const searchParams = await props.searchParams;
  const invite = typeof searchParams.invite === "string" ? searchParams.invite : "";
  const isFirstPlayer = !(await reads.accounts.hasAnyPlayers());

  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      {isFirstPlayer && (
        <p className="border-warning-line bg-warning-soft text-warning-ink rounded-md border px-3 py-2 text-sm">
          Nobody has registered yet. The first account becomes the <strong>admin</strong> and needs
          no invite code.
        </p>
      )}
      <RegisterForm
        needsInvite={!isFirstPlayer}
        inviteCode={invite}
        passwordMinLength={PASSWORD_MIN_LENGTH}
      />
      <p className="text-muted text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
