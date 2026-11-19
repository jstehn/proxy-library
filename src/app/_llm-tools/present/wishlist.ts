import type { WishlistView } from "@/modules/wishlist";

type Line = WishlistView["lines"][number];

function lineView(line: Line) {
  return {
    wishId: line.wish.id,
    name: line.name,
    quantity: line.wish.quantity,
    owned: line.owned,
    missing: line.missing,
    bestPriceCents: line.offer === null ? null : Math.round(line.offer.price),
    totalForMissingCents: line.total === null ? null : Math.round(line.total),
    targetPriceCents: line.wish.targetPrice === null ? null : Math.round(line.wish.targetPrice),
    atTarget: line.atTarget,
    status:
      line.status.kind === "shortBy"
        ? `shortBy:${Math.round(line.status.shortfall)}c/${line.status.paydays}p`
        : line.status.kind,
    ...(line.wish.note ? { note: line.wish.note } : {}),
  };
}

/** manage_wishlist action "list": the balance, what the missing cards cost, and each wish. */
export function presentWishlist(view: WishlistView): unknown {
  return {
    balanceCents: Math.round(view.balance),
    totalForMissingCents: Math.round(view.totalForMissing),
    wishes: view.lines.map(lineView),
  };
}
