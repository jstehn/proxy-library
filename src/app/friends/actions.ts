"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UserId } from "@/shared/kernel";
import { readPage } from "@/server/page-instance";

const userIdSchema = z.string().min(1);

function revalidateSocialPaths() {
  revalidatePath("/friends");
  revalidatePath("/players", "layout");
  revalidatePath("/activity");
  revalidatePath("/", "layout");
}

export async function sendFriendRequestAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const target = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!target.success) return;
  await capabilities.social.sendFriendRequest(actor.userId, UserId.of(target.data));
  revalidateSocialPaths();
}

export async function acceptFriendRequestAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const requester = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!requester.success) return;
  await capabilities.social.acceptFriendRequest(actor.userId, UserId.of(requester.data));
  revalidateSocialPaths();
}

export async function declineFriendRequestAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const requester = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!requester.success) return;
  await capabilities.social.declineFriendRequest(actor.userId, UserId.of(requester.data));
  revalidateSocialPaths();
}

export async function cancelFriendRequestAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const addressee = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!addressee.success) return;
  await capabilities.social.cancelFriendRequest(actor.userId, UserId.of(addressee.data));
  revalidateSocialPaths();
}

export async function unfriendAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const friend = userIdSchema.safeParse(formData.get("targetUserId"));
  if (!friend.success) return;
  await capabilities.social.unfriend(actor.userId, UserId.of(friend.data));
  revalidateSocialPaths();
}
