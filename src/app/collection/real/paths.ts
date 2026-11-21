import { revalidatePath } from "next/cache";
import { DECKS_PATH } from "../../decks/paths";

// The real collection's paths, and what to refresh after a change.

export const REAL_COLLECTION_PATH = "/collection/real";

/** The real collection's page with a sentence to show on it. */
export function realCollectionMessagePath(message: string): string {
  return `${REAL_COLLECTION_PATH}?message=${encodeURIComponent(message)}`;
}

/** The page, and the decks (real copies count as owned in a deck that uses them). */
export function revalidateRealCollection(): void {
  revalidatePath(REAL_COLLECTION_PATH);
  revalidatePath(DECKS_PATH);
}

/** The store's set pages, which show "I own this for real". */
export function revalidateStoreSetPages(): void {
  revalidatePath("/store/[code]", "page");
}
