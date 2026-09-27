"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer } from "@/server/container";

export async function signOutAction(): Promise<void> {
  await getContainer().accounts.signOut(await headers());
  redirect("/sign-in");
}
