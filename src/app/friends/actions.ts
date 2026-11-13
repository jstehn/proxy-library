"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { UserId } from "@/shared/kernel";

const userIdSchema = z.string().min(1);

function revalidateSocialPaths() {
  revalidatePath("/friends");
  revalidatePath("/players", "layout");
  revalidatePath("/activity");
  revalidatePath("/", "layout");
}

export async function sendFriendRequestAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const target = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!target.success) return;
  await getContainer().social.sendFriendRequest(actor.userId, UserId.of(target.data));
  revalidateSocialPaths();
}

export async function acceptFriendRequestAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const requester = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!requester.success) return;
  await getContainer().social.acceptFriendRequest(actor.userId, UserId.of(requester.data));
  revalidateSocialPaths();
}

export async function declineFriendRequestAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const requester = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!requester.success) return;
  await getContainer().social.declineFriendRequest(actor.userId, UserId.of(requester.data));
  revalidateSocialPaths();
}

export async function cancelFriendRequestAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const addressee = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!addressee.success) return;
  await getContainer().social.cancelFriendRequest(actor.userId, UserId.of(addressee.data));
  revalidateSocialPaths();
}

export async function unfriendAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const friend = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!friend.success) return;
  await getContainer().social.unfriend(actor.userId, UserId.of(friend.data));
  revalidateSocialPaths();
}
