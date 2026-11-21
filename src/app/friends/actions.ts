"use server";

import { z } from "zod";
import type { Capabilities } from "@/server/capabilities";
import { formVoid } from "@/server/form-action-instance";
import { UserId } from "@/shared/kernel";
import { revalidateSocial } from "./paths";

// Each friends button sends one player's id and does one thing with it. A form that can't be read
// does nothing.

/** The five buttons differ only in what they ask `social` to do. */
function friendAction(
  change: (social: Capabilities["social"], me: UserId, other: UserId) => Promise<unknown>,
) {
  return formVoid(
    z.object({ targetUserId: z.string().min(1) }),
    async ({ actor, capabilities }, { targetUserId }) => {
      await change(capabilities.social, actor.userId, UserId.of(targetUserId));
      revalidateSocial();
    },
  );
}

export const sendFriendRequestAction = friendAction((social, me, other) =>
  social.sendFriendRequest(me, other),
);

export const acceptFriendRequestAction = friendAction((social, me, other) =>
  social.acceptFriendRequest(me, other),
);

export const declineFriendRequestAction = friendAction((social, me, other) =>
  social.declineFriendRequest(me, other),
);

export const cancelFriendRequestAction = friendAction((social, me, other) =>
  social.cancelFriendRequest(me, other),
);

export const unfriendAction = friendAction((social, me, other) => social.unfriend(me, other));
