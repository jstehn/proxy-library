import { err, ok, type Result, type UserId } from "@/shared/kernel";
import { newFriendRequest, type Friendship } from "../domain/friendship";
import type { SocialDependencies } from "./ports";

export type SendFriendRequestError =
  | { kind: "CannotFriendSelf" }
  | { kind: "PlayerNotFound" }
  | { kind: "AlreadyFriends" }
  | { kind: "RequestAlreadyPending" };

export type AcceptFriendRequestError =
  | { kind: "RequestNotFound" }
  | { kind: "NotAddressee" }
  | { kind: "AlreadyFriends" }
  | { kind: "PlayerNotFound" };

export type DeclineFriendRequestError =
  { kind: "RequestNotFound" } | { kind: "NotAddressee" } | { kind: "AlreadyFriends" };

export type CancelFriendRequestError =
  { kind: "RequestNotFound" } | { kind: "NotRequester" } | { kind: "AlreadyFriends" };

export type UnfriendError = { kind: "FriendshipNotFound" };

export function makeSendFriendRequest({ unitOfWork, clock }: SocialDependencies) {
  return async function sendFriendRequest(
    requesterId: UserId,
    addresseeId: UserId,
  ): Promise<Result<Friendship, SendFriendRequestError>> {
    if (requesterId === addresseeId) return err({ kind: "CannotFriendSelf" });

    return unitOfWork.run<Friendship, SendFriendRequestError>(async (services) => {
      const targetActive = await services.socialPlayers.isActivePlayer(addresseeId);
      if (!targetActive) return err({ kind: "PlayerNotFound" });

      const existing = await services.friendships.findBetween(requesterId, addresseeId);
      if (existing !== null) {
        if (existing.status === "accepted") return err({ kind: "AlreadyFriends" });
        return err({ kind: "RequestAlreadyPending" });
      }

      const friendship = newFriendRequest({
        requesterId,
        addresseeId,
        now: clock.now(),
      });
      await services.friendships.insert(friendship);
      return ok(friendship);
    });
  };
}

export function makeAcceptFriendRequest({ unitOfWork, clock }: SocialDependencies) {
  return async function acceptFriendRequest(
    actorId: UserId,
    requesterId: UserId,
  ): Promise<Result<Friendship, AcceptFriendRequestError>> {
    return unitOfWork.run<Friendship, AcceptFriendRequestError>(async (services) => {
      const requesterActive = await services.socialPlayers.isActivePlayer(requesterId);
      if (!requesterActive) return err({ kind: "PlayerNotFound" });

      const existing = await services.friendships.findBetween(actorId, requesterId);
      if (existing === null) return err({ kind: "RequestNotFound" });
      if (existing.status === "accepted") return err({ kind: "AlreadyFriends" });
      if (existing.addresseeId !== actorId) return err({ kind: "NotAddressee" });

      const acceptedAt = clock.now();
      await services.friendships.markAccepted(
        existing.requesterId,
        existing.addresseeId,
        acceptedAt,
      );
      return ok({ ...existing, status: "accepted", acceptedAt });
    });
  };
}

export function makeDeclineFriendRequest({ unitOfWork }: SocialDependencies) {
  return async function declineFriendRequest(
    actorId: UserId,
    requesterId: UserId,
  ): Promise<Result<void, DeclineFriendRequestError>> {
    return unitOfWork.run<void, DeclineFriendRequestError>(async (services) => {
      const existing = await services.friendships.findBetween(actorId, requesterId);
      if (existing === null) return err({ kind: "RequestNotFound" });
      if (existing.status === "accepted") return err({ kind: "AlreadyFriends" });
      if (existing.addresseeId !== actorId) return err({ kind: "NotAddressee" });

      await services.friendships.deleteBetween(actorId, requesterId);
      return ok(undefined);
    });
  };
}

export function makeCancelFriendRequest({ unitOfWork }: SocialDependencies) {
  return async function cancelFriendRequest(
    actorId: UserId,
    addresseeId: UserId,
  ): Promise<Result<void, CancelFriendRequestError>> {
    return unitOfWork.run<void, CancelFriendRequestError>(async (services) => {
      const existing = await services.friendships.findBetween(actorId, addresseeId);
      if (existing === null) return err({ kind: "RequestNotFound" });
      if (existing.status === "accepted") return err({ kind: "AlreadyFriends" });
      if (existing.requesterId !== actorId) return err({ kind: "NotRequester" });

      await services.friendships.deleteBetween(actorId, addresseeId);
      return ok(undefined);
    });
  };
}

export function makeUnfriend({ unitOfWork }: SocialDependencies) {
  return async function unfriend(
    actorId: UserId,
    friendUserId: UserId,
  ): Promise<Result<void, UnfriendError>> {
    return unitOfWork.run<void, UnfriendError>(async (services) => {
      const existing = await services.friendships.findBetween(actorId, friendUserId);
      if (existing === null || existing.status !== "accepted") {
        return err({ kind: "FriendshipNotFound" });
      }
      await services.friendships.deleteBetween(actorId, friendUserId);
      return ok(undefined);
    });
  };
}
