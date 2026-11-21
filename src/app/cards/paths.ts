import { revalidatePath } from "next/cache";
import { revalidateHeader } from "../paths";

// The card page's paths, and what to refresh after a change.

/** A card's page, with `?realError=` when a real-copies change was refused. */
export function cardPath(printingId: string, realError?: string): string {
  const path = `/cards/${printingId}`;
  return realError === undefined ? path : `${path}?realError=${realError}`;
}

/** The card's page. */
export function revalidateCard(printingId: string): void {
  revalidatePath(cardPath(printingId));
}

/** After a buy or a sale on the card's page: the page and the header's balance. */
export function revalidateCardAndHeader(printingId: string): void {
  revalidateHeader();
  revalidateCard(printingId);
}
