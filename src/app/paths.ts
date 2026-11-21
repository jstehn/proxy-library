import { revalidatePath } from "next/cache";

// What every area shares: the layout around each page. Each area's own `paths.ts` says what else
// to refresh.

/**
 * Everything that sits around the pages: the header's balance, badges and draft reminder. Call it
 * after anything that moves money or changes a count the header shows.
 */
export function revalidateHeader(): void {
  revalidatePath("/", "layout");
}
