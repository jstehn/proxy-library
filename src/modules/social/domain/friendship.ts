import type { UserId } from "@/shared/kernel";

export type FriendshipStatus = "pending" | "accepted";

export type Friendship = Readonly<{
  requesterId: UserId;
  addresseeId: UserId;
  status: FriendshipStatus;
  createdAt: Date;
  acceptedAt: Date | null;
}>;

export type ViewerRelation = "self" | "friend" | "pending_outgoing" | "pending_incoming" | "none";

export function newFriendRequest(input: {
  requesterId: UserId;
  addresseeId: UserId;
  now: Date;
}): Friendship {
  return {
    requesterId: input.requesterId,
    addresseeId: input.addresseeId,
    status: "pending",
    createdAt: input.now,
    acceptedAt: null,
  };
}
