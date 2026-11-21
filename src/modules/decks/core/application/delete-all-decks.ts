import type { UserId } from "@/shared/kernel";
import type { DecksServices } from "./ports";

/** Deletes every deck a player has, inside the caller's transaction. Returns how many. */
export async function deleteAllDecks(
  services: Pick<DecksServices, "decks">,
  ownerId: UserId,
): Promise<number> {
  return services.decks.deleteAllOf(ownerId);
}
