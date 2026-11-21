import { revalidatePath } from "next/cache";
import { revalidateHeader } from "../paths";

// The wishlist area's paths, and what to refresh after a change.

export const WISHLIST_PATH = "/wishlist";

/** The Wishlist page after a buy or a filled wish: the query that says what was bought. */
export function boughtPath(name: string, paidCents: number): string {
  const query = new URLSearchParams({ bought: name, paid: String(paidCents) });
  return `${WISHLIST_PATH}?${query.toString()}`;
}

/** The wishlist, the card's page when given, and the header (its badge and balance). */
export function revalidateWishlist(printingId?: string): void {
  revalidateHeader();
  revalidatePath(WISHLIST_PATH);
  if (printingId !== undefined) revalidatePath(`/cards/${printingId}`);
}

/** Sharing the wishlist also changes what the trade builder offers. */
export function revalidateWishlistSharing(): void {
  revalidatePath(WISHLIST_PATH);
  revalidatePath("/trades");
}
