import Link from "next/link";
import { listFriendRequests, listFriends, searchPlayers } from "@/modules/social";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { LocalTime } from "@/ui/local-time";
import {
  acceptFriendRequestAction,
  cancelFriendRequestAction,
  declineFriendRequestAction,
  sendFriendRequestAction,
  unfriendAction,
} from "./actions";

export default async function FriendsPage(props: PageProps<"/friends">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const query = typeof searchParams.q === "string" ? searchParams.q : "";

  const [friends, requests, players] = await Promise.all([
    listFriends(db, actor.userId),
    listFriendRequests(db, actor.userId),
    searchPlayers(db, actor.userId, query),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Friends</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect with players in your playgroup, view profiles, and filter the activity feed.
          </p>
        </div>
        <Link href={`/players/${actor.username}`} className="text-sm underline">
          Your profile
        </Link>
      </header>

      {requests.incoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Friend requests ({requests.incoming.length})</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {requests.incoming.map((req) => (
              <li
                key={req.userId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div>
                  <Link href={`/players/${req.username}`} className="font-medium underline">
                    {req.displayName}
                  </Link>{" "}
                  <span className="text-muted text-xs">@{req.username}</span>
                  <div className="text-muted text-xs">
                    Sent <LocalTime iso={req.createdAt} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={acceptFriendRequestAction}>
                    <input type="hidden" name="targetUserId" value={req.userId} />
                    <button
                      type="submit"
                      className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      Accept
                    </button>
                  </form>
                  <form action={declineFriendRequestAction}>
                    <input type="hidden" name="targetUserId" value={req.userId} />
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
                    >
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Your friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <p className="text-muted text-sm">
            No friends yet. Find players in the directory below to send a request.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {friends.map((friend) => (
              <li
                key={friend.userId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div>
                  <Link href={`/players/${friend.username}`} className="font-medium underline">
                    {friend.displayName}
                  </Link>{" "}
                  <span className="text-muted text-xs">@{friend.username}</span>
                  <div className="text-muted text-xs">
                    Friends since <LocalTime iso={friend.since} />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Link href={`/trades/new?with=${friend.userId}`} className="underline">
                    Propose trade
                  </Link>
                  <form action={unfriendAction}>
                    <input type="hidden" name="targetUserId" value={friend.userId} />
                    <button
                      type="submit"
                      className="text-zinc-600 underline hover:text-red-600 dark:text-zinc-400"
                    >
                      Unfriend
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {requests.outgoing.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Sent requests ({requests.outgoing.length})</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {requests.outgoing.map((req) => (
              <li
                key={req.userId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div>
                  <Link href={`/players/${req.username}`} className="font-medium underline">
                    {req.displayName}
                  </Link>{" "}
                  <span className="text-muted text-xs">@{req.username}</span>
                </div>
                <form action={cancelFriendRequestAction}>
                  <input type="hidden" name="targetUserId" value={req.userId} />
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
                  >
                    Cancel request
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Find players</h2>
          <form method="get" action="/friends" className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search name or @username"
              className="rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-sm dark:border-zinc-700"
            />
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              Search
            </button>
          </form>
        </div>

        {players.length === 0 ? (
          <p className="text-muted text-sm">No matching players found.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {players.map((player) => (
              <li
                key={player.userId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div>
                    <Link href={`/players/${player.username}`} className="font-medium underline">
                      {player.displayName}
                    </Link>{" "}
                    <span className="text-muted text-xs">@{player.username}</span>
                  </div>
                  {player.bio && (
                    <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
                      {player.bio}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {player.relation === "none" && (
                    <form action={sendFriendRequestAction}>
                      <input type="hidden" name="targetUserId" value={player.userId} />
                      <button
                        type="submit"
                        className="rounded-md bg-zinc-900 px-3 py-1 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        Add friend
                      </button>
                    </form>
                  )}
                  {player.relation === "pending_outgoing" && (
                    <span className="text-muted">Request sent</span>
                  )}
                  {player.relation === "pending_incoming" && (
                    <form action={acceptFriendRequestAction}>
                      <input type="hidden" name="targetUserId" value={player.userId} />
                      <button
                        type="submit"
                        className="rounded-md bg-zinc-900 px-3 py-1 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        Accept request
                      </button>
                    </form>
                  )}
                  {player.relation === "friend" && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Friends
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
