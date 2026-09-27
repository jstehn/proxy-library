import Link from "next/link";
import { getContainer } from "@/server/container";
import { getCurrentActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { signOutAction } from "./actions";

/** The bar across the top of every page: who you are, where you can go, and sign out. */
export async function SiteHeader() {
  const actor = await getCurrentActor();
  // Showing the balance also pays any allowance that has come due (design doc 03, section 5).
  const balance = actor === null ? null : await getContainer().wallet.refreshWallet(actor.userId);

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold">
          TCG Virtual Library
        </Link>
        {actor !== null && (
          <>
            <Link href="/store">Store</Link>
            <Link href="/singles">Singles</Link>
            <Link href="/inventory">Inventory</Link>
            <Link href="/collection">Collection</Link>
            <Link href="/decks">Decks</Link>
            <Link href="/sets">Sets</Link>
          </>
        )}
        {actor !== null && actor.isAdmin && (
          <>
            <Link href="/admin/catalog">Catalog</Link>
            <Link href="/admin/packs">Pack lab</Link>
            <Link href="/admin/store">Prices</Link>
            <Link href="/admin/players">Players</Link>
            <Link href="/admin/invites">Invites</Link>
            <Link href="/admin/economy">Economy</Link>
          </>
        )}
        <span className="flex-1" />
        {actor === null ? (
          <Link href="/sign-in">Sign in</Link>
        ) : (
          <>
            {balance !== null && (
              <Link href="/wallet" className="font-medium tabular-nums" title="Your wallet">
                {Cents.format(balance)}
              </Link>
            )}
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
