import {
  makeAcceptFriendRequest,
  makeCancelFriendRequest,
  makeDeclineFriendRequest,
  makeSendFriendRequest,
  makeUnfriend,
} from "./manage-friends";
import type { SocialDependencies } from "./ports";
import { makeUpdateProfile } from "./update-profile";

export function makeSocial(dependencies: SocialDependencies) {
  return {
    updateProfile: makeUpdateProfile(dependencies),
    sendFriendRequest: makeSendFriendRequest(dependencies),
    acceptFriendRequest: makeAcceptFriendRequest(dependencies),
    declineFriendRequest: makeDeclineFriendRequest(dependencies),
    cancelFriendRequest: makeCancelFriendRequest(dependencies),
    unfriend: makeUnfriend(dependencies),
  };
}

export type Social = ReturnType<typeof makeSocial>;
