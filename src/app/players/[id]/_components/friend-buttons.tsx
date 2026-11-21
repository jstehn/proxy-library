import Link from "next/link";
import {
  acceptFriendRequestAction,
  cancelFriendRequestAction,
  declineFriendRequestAction,
  sendFriendRequestAction,
  unfriendAction,
} from "@/app/friends/actions";
import type { PlayerProfileView } from "@/modules/social";
import { Button, buttonClass } from "@/ui/button";

/** What you can do about this player: edit your profile, friend requests, trade, real collection. */
export function FriendButtons(props: { profile: PlayerProfileView; isSharingReal: boolean }) {
  const { profile, isSharingReal } = props;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {profile.relation === "self" && (
        <Link href="/account/profile" className={buttonClass()}>
          Edit profile
        </Link>
      )}

      {profile.relation === "none" && (
        <form action={sendFriendRequestAction}>
          <input type="hidden" name="targetUserId" value={profile.userId} />
          <Button type="submit">Add friend</Button>
        </form>
      )}

      {profile.relation === "pending_outgoing" && (
        <form action={cancelFriendRequestAction}>
          <input type="hidden" name="targetUserId" value={profile.userId} />
          <Button type="submit" variant="secondary">
            Cancel request
          </Button>
        </form>
      )}

      {profile.relation === "pending_incoming" && (
        <>
          <form action={acceptFriendRequestAction}>
            <input type="hidden" name="targetUserId" value={profile.userId} />
            <Button type="submit">Accept friend request</Button>
          </form>
          <form action={declineFriendRequestAction}>
            <input type="hidden" name="targetUserId" value={profile.userId} />
            <Button type="submit" variant="secondary">
              Decline
            </Button>
          </form>
        </>
      )}

      {profile.relation === "friend" && (
        <form action={unfriendAction}>
          <input type="hidden" name="targetUserId" value={profile.userId} />
          <button
            type="submit"
            className="border-line text-muted rounded-md border px-3 py-1.5 hover:border-red-400 hover:text-red-600"
          >
            Unfriend
          </button>
        </form>
      )}

      {profile.relation !== "self" && (
        <Link
          href={`/trades/new?with=${profile.userId}`}
          className={buttonClass({ variant: "secondary" })}
        >
          Propose trade
        </Link>
      )}

      {isSharingReal && (
        <Link
          href={`/players/${profile.userId}/real`}
          className={buttonClass({ variant: "secondary" })}
        >
          Real collection
        </Link>
      )}
    </div>
  );
}
