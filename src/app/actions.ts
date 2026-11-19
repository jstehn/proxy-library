"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readPage } from "@/server/page-instance";

export async function signOutAction(): Promise<void> {
  const { capabilities } = await readPage({ allowVisitors: true });
  await capabilities.accounts.signOut(await headers());
  redirect("/sign-in");
}
