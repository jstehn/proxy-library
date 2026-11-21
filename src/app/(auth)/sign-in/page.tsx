import Link from "next/link";
import { redirect } from "next/navigation";
import { describeExternalSignInError } from "@/modules/accounts";
import { externalSignInName, getCurrentActor } from "@/server/session";
import { safeNextPath } from "@/server/next-path";
import { Alert, SubmitButton } from "@/ui/form";
import { signInWithExternalAction } from "./actions";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const query = await props.searchParams;
  const next = safeNextPath(query.next);
  if ((await getCurrentActor()) !== null) redirect(next ?? "/");
  const externalName = externalSignInName();
  const externalError = describeExternalSignInError(
    typeof query.error === "string" ? query.error : undefined,
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {externalError !== null && <Alert tone="error">{externalError}</Alert>}
      <SignInForm next={next} />
      {externalName !== null && (
        <form action={signInWithExternalAction} className="flex flex-col gap-2">
          {next !== null && <input type="hidden" name="next" value={next} />}
          <SubmitButton tone="secondary" pendingText="Opening…">
            Sign in with {externalName}
          </SubmitButton>
        </form>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        New here?{" "}
        <Link href="/register" className="underline">
          Register with an invite code
        </Link>
        .
      </p>
    </>
  );
}
