import type { DbExecutor } from "@/shared/db";
import { realCards } from "../infrastructure/schema";

/**
 * Every printing someone owns for real: priced every night although its set isn't sold. Not a
 * read for players, so it isn't in `queries/index.ts`; the composition root hands it to the sync.
 */
export async function realPrintingIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.selectDistinct({ id: realCards.printingId }).from(realCards);
  return rows.map((row) => row.id);
}
