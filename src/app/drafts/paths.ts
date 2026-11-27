import { revalidatePath } from "next/cache";
import { revalidateHeader } from "../paths";

// The draft area's paths, and what to refresh after a change.

export const DRAFTS_PATH = "/drafts";

export function draftPath(draftId: number): string {
  return `${DRAFTS_PATH}/${draftId}`;
}

/** Just the draft's own page, without refreshing the list or header (for mid-draft picks). */
export function revalidateDraftOnly(draftId: number): void {
  revalidatePath(draftPath(draftId));
}

/** The list, the draft's page, and the header (the balance and the draft reminder). */
export function revalidateDraft(draftId: number): void {
  revalidatePath(DRAFTS_PATH);
  revalidatePath(draftPath(draftId));
  revalidateHeader();
}
