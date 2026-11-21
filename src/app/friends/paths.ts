import { revalidatePath } from "next/cache";
import { revalidateHeader } from "../paths";

// The friends area's paths, and what to refresh after a change.

export const FRIENDS_PATH = "/friends";

/** The friends list, the player pages, the activity feed and the header's friend-request badge. */
export function revalidateSocial(): void {
  revalidatePath(FRIENDS_PATH);
  revalidatePath("/players", "layout");
  revalidatePath("/activity");
  revalidateHeader();
}
