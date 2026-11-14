import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { auditDeck, auditDeckView, type DeckAuditReport } from "./audit";
import { publicDeckByToken } from "./sharing";

export type PublicDeckScorecard = Readonly<{
  ownerName: string;
  report: DeckAuditReport;
}>;

/**
 * Builds a shareable scorecard for a publicly shared deck token.
 */
export async function publicDeckScorecard(
  db: DbExecutor,
  token: string,
): Promise<PublicDeckScorecard | null> {
  const found = await publicDeckByToken(db, token);
  if (found === null) return null;
  const report = await auditDeckView(db, found.view);
  return {
    ownerName: found.ownerName,
    report,
  };
}

/**
 * Builds a scorecard for an owned deck.
 */
export async function deckScorecard(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckAuditReport | null> {
  return auditDeck(db, userId, deckId);
}
