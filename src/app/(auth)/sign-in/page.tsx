import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/session";
import { safeNextPath } from "@/server/next-path";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const next = safeNextPath((await props.searchParams).next);
  if ((await getCurrentActor()) !== null) redirect(next ?? "/");

  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <SignInForm next={next} />
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
