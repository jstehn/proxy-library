// Helpers every page and server action uses to find out who is signed in.
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Actor, AdminActor } from "@/modules/accounts";
import { getContainer } from "./composition/container";

/** What the sign-in button calls the outside provider (Authentik), or null when none is set up. */
export function externalSignInName(): string | null {
  return getContainer().config.oidc?.providerName ?? null;
}

/** The signed-in player, or null. */
export async function getCurrentActor(): Promise<Actor | null> {
  return getContainer().accounts.getActor(await headers());
}

/**
 * The signed-in player. Signed-out visitors are sent to /sign-in, and players who must
 * change their password (after an admin reset) are sent to do that first.
 */
export async function requireActor(options: { allowPasswordChangePending?: boolean } = {}) {
  const actor = await getCurrentActor();
  if (actor === null) redirect("/sign-in");
  if (actor.mustChangePassword && !options.allowPasswordChangePending) {
    redirect("/account/password");
  }
  return actor;
}

/** The signed-in admin. Anyone else sees "not found", which also hides that the page exists. */
export async function requireAdminActor(): Promise<AdminActor> {
  const admin = getContainer().accounts.asAdmin(await requireActor());
  if (admin === null) notFound();
  return admin;
}
