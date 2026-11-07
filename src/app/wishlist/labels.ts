import type { Finish } from "@/modules/catalog";
import type { Offer } from "@/modules/wishlist";

// Words for the wishlist's screens, shared by the page (server) and its forms (client).

export const FINISH_NAMES: Record<Finish, string> = {
  nonfoil: "nonfoil",
  foil: "foil",
  etched: "etched",
};

/** "M3C #217 · Extended Art · foil": which printing an offer is. */
export function offerLabel(offer: Offer): string {
  return [
    `${offer.setCode} #${offer.collectorNumber}`,
    offer.variantLabel,
    offer.finish === "nonfoil" ? "" : FINISH_NAMES[offer.finish],
  ]
    .filter((part) => part !== "")
    .join(" · ");
}
