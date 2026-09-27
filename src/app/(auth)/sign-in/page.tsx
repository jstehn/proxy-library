import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  if ((await getCurrentActor()) !== null) redirect("/");

  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <SignInForm />
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
