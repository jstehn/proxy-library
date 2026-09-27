import Link from "next/link";
import { getCurrentActor } from "@/server/session";
import { signOutAction } from "./actions";

/** The bar across the top of every page: who you are, where you can go, and sign out. */
export async function SiteHeader() {
  const actor = await getCurrentActor();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold">
          TCG Virtual Library
        </Link>
        {actor !== null && actor.isAdmin && (
          <>
            <Link href="/admin/players">Players</Link>
            <Link href="/admin/invites">Invites</Link>
          </>
        )}
        <span className="flex-1" />
        {actor === null ? (
          <Link href="/sign-in">Sign in</Link>
        ) : (
          <>
            <Link href="/account/password" title="Change password">
              {actor.displayName}
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="underline">
                Sign out
              </button>
            </form>
          </>
        )}
      </nav>
    </header>
  );
}
