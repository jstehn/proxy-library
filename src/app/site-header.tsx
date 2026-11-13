import Link from "next/link";
import { activeDraftOf } from "@/modules/drafts";
import { incomingRequestCount } from "@/modules/social";
import { tradesWaitingForYou } from "@/modules/trades";
import { wishesAtTarget } from "@/modules/wishlist";
import { getContainer } from "@/server/container";
import { getCurrentActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { MobileBottomNav } from "./_components/mobile-bottom-nav";
import { NavLink } from "./_components/nav-link";
import { PhoneMenu } from "./_components/phone-menu";
import { signOutAction } from "./actions";

const MAIN_LINKS = [
  ["/store", "Store"],
  ["/singles", "Singles"],
  ["/wishlist", "Wishlist"],
  ["/inventory", "Inventory"],
  ["/collection", "Collection"],
  ["/decks", "Decks"],
  ["/trades", "Trades"],
  ["/drafts", "Drafts"],
  ["/sets", "Sets"],
  ["/activity", "Activity"],
  ["/friends", "Friends"],
] as const;

/** The bar across the top of every page: who you are, where you can go, and sign out. */
export async function SiteHeader() {
  const actor = await getCurrentActor();
  // Showing the balance also pays any allowance that has come due (design doc 03, section 5).
  const balance = actor === null ? null : await getContainer().wallet.refreshWallet(actor.userId);
  const waitingTrades =
    actor === null ? 0 : await tradesWaitingForYou(getContainer().db, actor.userId);
  // Wishes at or under their target price (design doc 26, section 9).
  const wishesOnTarget = actor === null ? 0 : await wishesAtTarget(getContainer().db, actor.userId);
  // A lobby or draft you're seated at: the link goes straight back to it (design doc 17).
  const draft = actor === null ? null : await activeDraftOf(getContainer().db, actor.userId);
  const friendRequests =
    actor === null ? 0 : await incomingRequestCount(getContainer().db, actor.userId);

  // The same links in two layouts: inline on larger screens, in the "Menu" on phones.
  const links =
    actor === null
      ? null
      : [
          ...MAIN_LINKS.map(([href, label]) => (
            <NavLink
              key={href}
              href={href === "/drafts" && draft !== null ? `/drafts/${draft.id}` : href}
              matchPrefix={href}
            >
              {label}
              {href === "/drafts" && draft !== null && (
                <>
                  <span
                    aria-hidden="true"
                    className={`ml-1 inline-block h-2 w-2 rounded-full ${draft.status === "drafting" ? "bg-amber-500" : "bg-sky-500"}`}
                    title={
                      draft.status === "drafting" ? "Your draft is running" : "You're in a lobby"
                    }
                  />
                  <span className="sr-only">
                    {draft.status === "drafting" ? " (drafting)" : " (in lobby)"}
                  </span>
                </>
              )}
              {href === "/wishlist" && wishesOnTarget > 0 && (
                <span
                  className="ml-1 rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white"
                  title={`${wishesOnTarget} at or under your target price`}
                >
                  {wishesOnTarget}
                  <span className="sr-only"> at or under target price</span>
                </span>
              )}
              {href === "/trades" && waitingTrades > 0 && (
                <span
                  className="ml-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
                  title={`${waitingTrades} waiting for you`}
                >
                  {waitingTrades}
                  <span className="sr-only"> waiting for you</span>
                </span>
              )}
              {href === "/friends" && friendRequests > 0 && (
                <span
                  className="ml-1 rounded-full bg-sky-600 px-1.5 text-xs font-semibold text-white"
                  title={`${friendRequests} friend request${friendRequests === 1 ? "" : "s"}`}
                >
                  {friendRequests}
                  <span className="sr-only"> friend requests</span>
                </span>
              )}
            </NavLink>
          )),
          ...(actor.isAdmin
            ? [
                <NavLink key="/admin" href="/admin">
                  Admin
                </NavLink>,
              ]
            : []),
        ];

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-6xl items-center gap-x-3 px-4 py-3 text-sm"
      >
        <Link href="/" className="font-semibold">
          Proxy Library
        </Link>
        {links !== null && (
          <div className="hidden flex-wrap items-center gap-x-3 md:flex">{links}</div>
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
            <div className="hidden items-center gap-x-3 md:flex">
              <Link href="/account" title="Your account">
                {actor.displayName}
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="underline">
                  Sign out
                </button>
              </form>
            </div>
            <PhoneMenu>
              {links}
              <Link href="/account">{actor.displayName}: account</Link>
              <form action={signOutAction} className="px-2 py-1.5">
                <button type="submit" className="underline">
                  Sign out
                </button>
              </form>
            </PhoneMenu>
          </>
        )}
      </nav>
      {actor !== null && (
        <MobileBottomNav draftId={draft?.id ?? null} draftStatus={draft?.status ?? null} />
      )}
    </header>
  );
}
