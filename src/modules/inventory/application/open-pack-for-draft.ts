import { openBooster, type Pack, type PacksServices } from "@/modules/packs";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { AlreadyOpened, BoosterUnavailable, ItemNotFound, NotAPack } from "../domain/errors";
import { openTransition, type ItemId } from "../domain/item";
import type { InventoryServices } from "./ports";

/**
 * Opens one of a player's unopened booster packs into a draft (a Lore Seeker's added pack, design
 * doc 18), inside the caller's transaction. The item is marked opened with what it held, like any
 * opening, but the cards go to the draft, not to the player's collection.
 */
export async function openPackForDraft(
  services: Pick<InventoryServices, "items"> & PacksServices,
  input: Readonly<{ ownerId: UserId; itemId: ItemId; seed: string; now: Date }>,
): Promise<Result<Pack, ItemNotFound | AlreadyOpened | NotAPack | BoosterUnavailable>> {
  const locked = await services.items.lock(input.itemId);
  const transition = openTransition(locked, input.ownerId, input.now);
  if (!transition.ok) return transition;
  const item = transition.value;
  if (item.content.kind !== "pack") return err({ kind: "NotAPack" });
  const opened = await openBooster(services, {
    setCode: item.content.setCode,
    boosterType: item.content.boosterType,
    seed: input.seed,
  });
  if (!opened.ok) return opened;
  await services.items.markOpened(item, {
    kind: "pack",
    seed: input.seed,
    variantIndex: opened.value.variantIndex,
    cards: opened.value.cards,
  });
  return ok(opened.value);
}
