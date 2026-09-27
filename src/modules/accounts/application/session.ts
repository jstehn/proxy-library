import { ok } from "@/shared/kernel";
import { isActive, toActor, type Actor } from "../domain/player";
import type { AccountsDependencies } from "./ports";

/**
 * Who is signed in on this request? Returns null when nobody is, and also when the player
 * is disabled or has no player row. Every page and action that needs a player calls this.
 */
export function makeGetActor(dependencies: AccountsDependencies) {
  const { unitOfWork, identity } = dependencies;

  async function getActor(requestHeaders: Headers): Promise<Actor | null> {
    const userId = await identity.currentUserId(requestHeaders);
    if (userId === null) return null;

    const player = await unitOfWork.run(async ({ players }) => ok(await players.findById(userId)));
    if (!player.ok || player.value === null || !isActive(player.value)) return null;
    return toActor(player.value);
  }

  return getActor;
}

/** Ends this browser's session. */
export function makeSignOut(dependencies: AccountsDependencies) {
  const { identity } = dependencies;

  async function signOut(requestHeaders: Headers): Promise<void> {
    await identity.signOut(requestHeaders);
  }

  return signOut;
}
