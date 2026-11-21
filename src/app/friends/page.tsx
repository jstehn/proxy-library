import Link from "next/link";
import { LocalTime } from "@/ui/local-time";
import {
  acceptFriendRequestAction,
  cancelFriendRequestAction,
  declineFriendRequestAction,
  sendFriendRequestAction,
  unfriendAction,
} from "./actions";
import { readPage } from "@/server/page-instance";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Page } from "@/ui/page";
import { EmptyState } from "@/ui/empty-state";

const ONLINE_BADGE =
  "rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";

export default async function FriendsPage(props: PageProps<"/friends">) {
  const { actor, reads } = await readPage();

  const searchParams = await props.searchParams;
  const query = typeof searchParams.q === "string" ? searchParams.q : "";

  const [friends, requests, players] = await Promise.all([
    reads.social.friends(actor),
    reads.social.friendRequests(actor),
    reads.social.searchPlayers(actor, query),
  ]);

  return (
    <Page spacing="wide">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Friends</h1>
          <p className="text-muted text-sm">
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
          <Card as="ul" divided>
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
                      className="bg-accent text-accent-foreground rounded-md px-3 py-1 text-xs font-medium"
                    >
                      Accept
                    </button>
                  </form>
                  <form action={declineFriendRequestAction}>
                    <input type="hidden" name="targetUserId" value={req.userId} />
                    <button
                      type="submit"
                      className="border-line rounded-md border px-3 py-1 text-xs"
                    >
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </Card>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Your friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <p className="text-muted text-sm">
            No friends yet. Find players in the directory below to send a request.
          </p>
        ) : (
          <Card as="ul" divided>
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
                    <button type="submit" className="text-muted underline hover:text-red-600">
                      Unfriend
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </Card>
        )}
      </section>

      {requests.outgoing.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Sent requests ({requests.outgoing.length})</h2>
          <Card as="ul" divided>
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
                  <button type="submit" className="border-line rounded-md border px-3 py-1 text-xs">
                    Cancel request
                  </button>
                </form>
              </li>
            ))}
          </Card>
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
              className="border-line rounded-md border bg-transparent px-3 py-1 text-sm"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>
        </div>

        {players.length === 0 ? (
          <EmptyState>No matching players found.</EmptyState>
        ) : (
          <Card as="ul" divided>
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
                  {player.bio && <p className="text-muted mt-0.5 truncate text-xs">{player.bio}</p>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {player.relation === "none" && (
                    <form action={sendFriendRequestAction}>
                      <input type="hidden" name="targetUserId" value={player.userId} />
                      <Button type="submit" size="sm">
                        Add friend
                      </Button>
                    </form>
                  )}
                  {player.relation === "pending_outgoing" && (
                    <span className="text-muted">Request sent</span>
                  )}
                  {player.relation === "pending_incoming" && (
                    <form action={acceptFriendRequestAction}>
                      <input type="hidden" name="targetUserId" value={player.userId} />
                      <Button type="submit" size="sm">
                        Accept request
                      </Button>
                    </form>
                  )}
                  {player.relation === "friend" && <span className={ONLINE_BADGE}>Friends</span>}
                </div>
              </li>
            ))}
          </Card>
        )}
      </section>
    </Page>
  );
}
