import { revalidatePath } from "next/cache";

// The account area's paths, and what to refresh after a change.

export const ACCOUNT_PATH = "/account";
export const TOKENS_PATH = "/account/tokens";
export const PROFILE_PATH = "/account/profile";

export function playerPath(usernameOrId: string): string {
  return `/players/${usernameOrId}`;
}

export function revalidateAccount(): void {
  revalidatePath(ACCOUNT_PATH);
}

export function revalidateTokens(): void {
  revalidatePath(TOKENS_PATH);
}

/** After a profile change: the player's page under both addresses, the form and the friends list. */
export function revalidateProfile(player: { username: string; userId: string }): void {
  revalidatePath(playerPath(player.username));
  revalidatePath(playerPath(player.userId));
  revalidatePath(PROFILE_PATH);
  revalidatePath("/friends");
}
