import type { DbExecutor } from "@/shared/db";
import type { DeckAuditReport } from "@/modules/decks/building/client";
import { auditDeckView } from "@/modules/decks/building";
import { publicDeck } from "@/modules/decks/sharing";

export type PublicDeckScorecard = Readonly<{
  ownerName: string;
  report: DeckAuditReport;
}>;

/**
 * Builds a shareable scorecard for a publicly shared deck token.
 */
export async function publicScorecard(
  db: DbExecutor,
  token: string,
): Promise<PublicDeckScorecard | null> {
  const found = await publicDeck(db, token);
  if (found === null) return null;
  const report = await auditDeckView(db, found.view);
  return {
    ownerName: found.ownerName,
    report,
  };
}
