import type { Actor } from "@/modules/accounts";
import type { DraftSeen, SeenCard } from "@/modules/drafts";
import type { Capabilities } from "@/server/composition/capabilities";
import type { Reads } from "@/server/composition/reads";
import { Cents } from "@/shared/kernel";
import { boosterLabel } from "../../labels";
import type { LoreSources } from "./pick-grid";

/** Every printing the page may need to name or show. */
export function printingIdsIn(seen: DraftSeen): string[] {
  const cards: SeenCard[] = [
    ...(seen.you?.pack?.cards ?? []),
    ...(seen.you?.pile ?? []),
    ...(seen.you?.awaiting === null || seen.you?.awaiting === undefined ? [] : [seen.you.awaiting]),
    ...seen.seats.flatMap((seat) => [...seat.faceUp, ...seat.noted, ...seat.removedFaceUp]),
    ...(seen.deal === null
      ? []
      : [seen.deal.revealed, ...seen.deal.offers.map((offer) => offer.card)].filter(
          (card): card is SeenCard => card !== null,
        )),
  ];
  return [
    ...cards.map((card) => card.printingId),
    ...seen.reveals.flatMap((reveal) => reveal.cards.map((card) => card.printingId)),
  ];
}

/**
 * Where a Lore Seeker's pack may come from, only worked out when one is in front of the player:
 * their unopened packs, and every booster with a store price (any set, decision 2).
 */
export async function loreSources(
  capabilities: Capabilities,
  reads: Reads,
  seen: DraftSeen,
  actor: Actor,
): Promise<LoreSources | null> {
  const you = seen.you;
  if (you === null) return null;
  const candidates = [...(you.pack?.cards ?? []), ...(you.awaiting === null ? [] : [you.awaiting])];
  const cards = await capabilities.printingDetails(candidates.map((card) => card.printingId));
  if (![...cards.values()].some((card) => card.name === "Lore Seeker")) return null;
  const [items, options, prices] = await Promise.all([
    reads.inventory.unopenedItems(actor),
    reads.drafts.boosterOptions(),
    reads.store.packMsrps(),
  ]);
  return {
    inventory: items
      .filter((group) => group.contentKind === "pack")
      .map((group) => ({
        itemId: group.itemIds[0],
        name: `${group.name} (${group.itemIds.length} owned)`,
      })),
    buy: options.flatMap((option) => {
      const price = prices.get(`${option.setCode}/${option.boosterType}`);
      return price === undefined
        ? []
        : [
            {
              ...option,
              label: `${option.setName} ${boosterLabel(option.boosterType)}: ${Cents.format(price)}`,
            },
          ];
    }),
  };
}
