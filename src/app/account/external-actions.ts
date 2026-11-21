"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readPage } from "@/server/page-instance";

// Controllers for linking and unlinking Authentik on the Account page (design doc 69, 4.2).

/** Sends the signed-in player to Authentik to prove the account is theirs; it links on return. */
export async function linkExternalAction(): Promise<void> {
  const { actor, capabilities } = await readPage();
  const url = await capabilities.accounts.startExternalLink(actor, await headers());
  redirect(url ?? "/account?error=unavailable");
}

/** Removes the link. The password still works, so this can't lock anyone out. */
export async function unlinkExternalAction(): Promise<void> {
  const { actor, capabilities } = await readPage();
  await capabilities.accounts.unlinkExternal(actor, await headers());
  revalidatePath("/account");
}
