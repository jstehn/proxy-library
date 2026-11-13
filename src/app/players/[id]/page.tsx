import Link from "next/link";
import { notFound } from "next/navigation";
import { CardTile } from "@/app/_components/card-tile";
import { formatLabel } from "@/app/decks/labels";
import {
  acceptFriendRequestAction,
  cancelFriendRequestAction,
  declineFriendRequestAction,
  sendFriendRequestAction,
  unfriendAction,
} from "@/app/friends/actions";
import { printingCards } from "@/modules/catalog";
import { sharedRealCollections } from "@/modules/real-collection";
import { getPlayerProfile } from "@/modules/social";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { LocalTime } from "@/ui/local-time";
import { ManaStylesheet } from "@/ui/mana";

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export default async function PlayerProfilePage(props: PageProps<"/players/[id]">) {
  const actor = await requireActor();
  const { id } = await props.params;
  const { db } = getContainer();

  const [profile, sharedReal] = await Promise.all([
    getPlayerProfile(db, actor.userId, id),
    sharedRealCollections(db),
  ]);

  if (profile === null) notFound();

  const isSharingReal = sharedReal.some((p) => p.userId === profile.userId);
  const showcasePrintings =
    profile.showcaseCards.length > 0
      ? await printingCards(
          db,
          profile.showcaseCards.map((c) => c.printingId),
        )
      : new Map();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <ManaStylesheet />

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
            <span className="text-muted text-sm">@{profile.username}</span>
            {profile.relation === "friend" && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Friends
              </span>
            )}
          </div>
          <p className="text-muted text-xs">
            Joined <LocalTime iso={profile.joinedAt} />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {profile.relation === "self" && (
            <Link
              href="/account/profile"
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Edit profile
            </Link>
          )}

          {profile.relation === "none" && (
            <form action={sendFriendRequestAction}>
              <input type="hidden" name="targetUserId" value={profile.userId} />
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Add friend
              </button>
            </form>
          )}

          {profile.relation === "pending_outgoing" && (
            <form action={cancelFriendRequestAction}>
              <input type="hidden" name="targetUserId" value={profile.userId} />
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
              >
                Cancel request
              </button>
            </form>
          )}

          {profile.relation === "pending_incoming" && (
            <>
              <form action={acceptFriendRequestAction}>
                <input type="hidden" name="targetUserId" value={profile.userId} />
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Accept friend request
                </button>
              </form>
              <form action={declineFriendRequestAction}>
                <input type="hidden" name="targetUserId" value={profile.userId} />
                <button
                  type="submit"
                  className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
                >
                  Decline
                </button>
              </form>
            </>
          )}

          {profile.relation === "friend" && (
            <form action={unfriendAction}>
              <input type="hidden" name="targetUserId" value={profile.userId} />
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Unfriend
              </button>
            </form>
          )}

          {profile.relation !== "self" && (
            <Link
              href={`/trades/new?with=${profile.userId}`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
            >
              Propose trade
            </Link>
          )}

          {isSharingReal && (
            <Link
              href={`/players/${profile.userId}/real`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
            >
              Real collection
            </Link>
          )}
        </div>
      </header>

      {(profile.bio || profile.favoriteColors.length > 0 || profile.favoriteFormats.length > 0) && (
        <section className="flex flex-col gap-3">
          {profile.bio && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
              {profile.bio}
            </p>
          )}
          <div className="flex flex-wrap gap-6 text-sm">
            {profile.favoriteColors.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs tracking-wide uppercase">Favorite colors</span>
                <span className="flex items-center gap-1">
                  {profile.favoriteColors.map((color) => (
                    <i
                      key={color}
                      className={`ms ms-${color.toLowerCase()} ms-cost ms-shadow`}
                      title={COLOR_LABELS[color] ?? color}
                      aria-label={COLOR_LABELS[color] ?? color}
                    />
                  ))}
                </span>
              </div>
            )}
            {profile.favoriteFormats.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs tracking-wide uppercase">Favorite formats</span>
                <span>{profile.favoriteFormats.map(formatLabel).join(" · ")}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {profile.showcaseDeck && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Showcase deck</h2>
          <Link
            href={`/decks/${profile.showcaseDeck.id}`}
            className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          >
            <div>
              <div className="font-medium underline">{profile.showcaseDeck.name}</div>
              <div className="text-muted text-xs">{formatLabel(profile.showcaseDeck.format)}</div>
            </div>
            <span className="text-xs underline">View deck</span>
          </Link>
        </section>
      )}

      {profile.showcaseCards.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Showcase cards</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {profile.showcaseCards.map((card) => {
              const printing = showcasePrintings.get(card.printingId);
              if (!printing) return null;
              return (
                <CardTile
                  key={card.printingId}
                  printing={printing}
                  priceLine={`${card.setCode.toUpperCase()} #${card.collectorNumber}`}
                  href={`/cards/${card.printingId}`}
                />
              );
            })}
          </ul>
        </section>
      )}

      {profile.stats !== null && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Stats</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="text-muted text-xs">Total cards</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.totalCards.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="text-muted text-xs">Unique printings</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.distinctCards.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="text-muted text-xs">Packs opened</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.packsOpened.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="text-muted text-xs">Shared decks</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.sharedDecks.toLocaleString()}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Shared decks ({profile.sharedDecks.length})</h2>
        {profile.sharedDecks.length === 0 ? (
          <p className="text-muted text-sm">No shared decks yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {profile.sharedDecks.map((deck) => (
              <li key={deck.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <Link href={`/decks/${deck.id}`} className="font-medium underline">
                    {deck.name}
                  </Link>
                  <span className="text-muted ml-2 text-xs">{formatLabel(deck.format)}</span>
                </div>
                <span className="text-muted text-xs">
                  Updated <LocalTime iso={deck.updatedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {profile.wishlist !== null && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Wishlist ({profile.wishlist.length})</h2>
            {profile.relation !== "self" && profile.wishlist.some((w) => w.youOwnCount > 0) && (
              <Link href={`/trades/new?with=${profile.userId}`} className="text-xs underline">
                Propose trade
              </Link>
            )}
          </div>
          {profile.wishlist.length === 0 ? (
            <p className="text-muted text-sm">Wishlist is empty.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {profile.wishlist.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <div>
                    <span className="font-medium">
                      {item.quantity}× {item.cardName}
                    </span>
                    <span className="text-muted ml-2 text-xs">({item.finish})</span>
                    {item.note && <p className="text-muted text-xs">{item.note}</p>}
                  </div>
                  {profile.relation !== "self" && item.youOwnCount > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      You own {item.youOwnCount}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
