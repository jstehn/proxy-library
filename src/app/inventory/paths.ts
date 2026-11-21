import { revalidatePath } from "next/cache";
import { DECKS_PATH } from "../decks/paths";

// The inventory's paths, and what to refresh after a change.

export const INVENTORY_PATH = "/inventory";

/** The inventory with an error code to show (the open form sends errors back as `?error=`). */
export function inventoryErrorPath(code: string): string {
  return `${INVENTORY_PATH}?error=${code}`;
}

/** After opening: the inventory, the collection and the deck list (opened precons become decks). */
export function revalidateOpened(): void {
  revalidatePath(INVENTORY_PATH);
  revalidatePath("/collection");
  revalidatePath(DECKS_PATH);
}
